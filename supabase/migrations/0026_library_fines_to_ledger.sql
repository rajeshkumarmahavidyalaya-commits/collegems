-- Library fines move into the fees ledger.
--
-- CLAUDE.md rule 6 has said since the beginning that `book_issues.fine_amount`
-- was a stopgap and that fines belonged in the ledger once one existed. It
-- does now, so this is that migration.
--
-- What changes: returning a book late no longer just stamps a number on the
-- issue row. It books an immutable `fine` entry against the student's fee
-- account, so an overdue book shows up in the same balance, on the same
-- collection screen, as tuition -- and is collected with the same receipt.
--
-- Four decisions worth reading before changing any of this.
--
-- 1. THE FINE IS BOOKED AT RETURN, NOT AS IT ACCRUES. An overdue book's fine
--    grows every day, and a ledger row is a fixed amount; a growing debt
--    cannot be one immutable entry without rewriting it daily, which is
--    exactly what the ledger forbids. So the ledger records the fine when it
--    is *final* -- at return -- and the library screen shows the running
--    amount before then as an estimate it computes on the fly. That also
--    matches how a library actually works: you settle when you hand the book
--    back.
--
-- 2. STAFF FINES DO NOT MOVE. `members` is a student **or** a staff member,
--    and `ledger_entries.student_id` is not null because the whole module is
--    student fees. A staff member's overdue book is a payroll or petty-cash
--    matter, not a fee receivable. Their fine stays on `book_issues.fine_amount`
--    and is not collectable through this module -- an explicit gap, recorded
--    in docs/modules/library.md rather than papered over.
--
-- 3. `fine_paid` IS DROPPED. Nothing reads or writes it and no row has ever
--    set it. For a student it is now answered by the fee balance, and keeping
--    a boolean that can silently disagree with the ledger is precisely the
--    drift the ledger exists to prevent. For staff it was never populated, so
--    dropping it removes a promise the schema was not keeping.
--
-- 4. THE RATE MOVES TO `settings`. It was a function default (2.00) that the
--    app could not see, so any accrual estimate in the UI would have been a
--    second hardcoded copy free to drift. One row in `settings`, read by both.

-- ---------------------------------------------------------------------------
-- Linking a ledger entry to the issue that caused it
-- ---------------------------------------------------------------------------

alter table public.book_issues
  add constraint book_issues_tenant_id_key unique (tenant_id, id);

alter table public.ledger_entries
  add column book_issue_id uuid;

-- Composite, for the same reason every other link in this schema is composite:
-- foreign key checks are not subject to RLS, so a single-column reference
-- would accept another tenant's issue id (see migration 0024).
--
-- `set null` on just the one column, not `restrict`: deleting a book cascades
-- to its issues, and money history must survive that. The entry keeps its
-- amount and its note naming the book; only the link goes.
alter table public.ledger_entries
  add constraint ledger_entries_book_issue_id_fkey
  foreign key (tenant_id, book_issue_id)
  references public.book_issues (tenant_id, id)
  on delete set null (book_issue_id);

-- One fine per issue, forever. This is what makes booking idempotent: a
-- double-submitted return, or a re-run of the backfill below, cannot fine a
-- family twice. Reversals are excluded so a fine can still be cancelled.
create unique index ledger_entries_book_issue_unique
  on public.ledger_entries (book_issue_id)
  where book_issue_id is not null and reverses_entry_id is null;

create index ledger_entries_tenant_book_issue_idx
  on public.ledger_entries (tenant_id, book_issue_id)
  where book_issue_id is not null;

-- ---------------------------------------------------------------------------
-- Librarians need a way in -- and only this way
-- ---------------------------------------------------------------------------

-- `library_return_book` is SECURITY INVOKER, so it writes as the librarian who
-- called it, and the finance-roles policy would reject them. Rather than making
-- the function SECURITY DEFINER (which would hand librarians the whole ledger),
-- this grants exactly one shape of row: a fine, carrying a book issue id.
-- A librarian still cannot record a payment, a discount, or a fine unattached
-- to a book.
create policy "librarians add library fines" on public.ledger_entries
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'librarian'
    and entry_type = 'fine'
    and book_issue_id is not null
  );

create policy "librarians view library fines" on public.ledger_entries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'librarian'
    and book_issue_id is not null
  );

-- ---------------------------------------------------------------------------
-- One rate, visible to both the function and the app
-- ---------------------------------------------------------------------------

insert into public.settings (tenant_id, key, value)
select t.id, 'library.fine_per_day', '{"amount": 2.00}'::jsonb
from public.tenants t
on conflict (tenant_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Returning a book
-- ---------------------------------------------------------------------------

create or replace function public.library_return_book(
  p_issue_id uuid,
  p_fine_per_day numeric default null
)
returns public.book_issues
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_issue public.book_issues;
  v_days_late integer;
  v_rate numeric;
  v_fine numeric;
  v_student_id uuid;
  v_session_id uuid;
  v_title text;
begin
  select * into v_issue from public.book_issues
  where id = p_issue_id and tenant_id = v_tenant_id
  for update;

  if v_issue.id is null then
    raise exception 'Issue record not found';
  end if;
  if v_issue.status = 'returned' then
    raise exception 'Already returned';
  end if;

  -- Explicit argument wins; otherwise the tenant's configured rate; otherwise
  -- the historical default, so a tenant with no settings row still works.
  v_rate := coalesce(
    p_fine_per_day,
    (select (s.value ->> 'amount')::numeric from public.settings s
      where s.tenant_id = v_tenant_id and s.key = 'library.fine_per_day'),
    2.00
  );

  v_days_late := greatest(0, (current_date - v_issue.due_at));
  v_fine := v_days_late * v_rate;

  update public.book_issues
  set status = 'returned',
      returned_at = now(),
      returned_by = auth.uid(),
      fine_amount = v_fine
  where id = p_issue_id
  returning * into v_issue;

  update public.books set available_copies = available_copies + 1
  where id = v_issue.book_id;

  -- Only a student member has a fee account. A staff member's fine stays on
  -- the issue row and is settled outside this module.
  if v_fine > 0 then
    select m.student_id into v_student_id
    from public.members m
    where m.id = v_issue.member_id and m.tenant_id = v_tenant_id;

    if v_student_id is not null then
      -- The current session, not the issue's: the debt arises when the book
      -- comes back late, and a fine filed against a closed year would never
      -- appear on the collection screen, which reports the current one.
      v_session_id := public.current_session_id(v_tenant_id);

      select b.title into v_title from public.books b where b.id = v_issue.book_id;

      if v_session_id is not null then
        insert into public.ledger_entries (
          tenant_id, session_id, student_id, entry_type, amount,
          occurred_at, note, book_issue_id, recorded_by
        ) values (
          v_tenant_id, v_session_id, v_student_id, 'fine', v_fine,
          now(),
          'Library fine: ' || coalesce(v_title, 'book') || ', ' ||
            v_days_late || ' day' || case when v_days_late = 1 then '' else 's' end ||
            ' overdue',
          v_issue.id, auth.uid()
        )
        -- Belt and braces with the unique index: a retried return converges
        -- on the fine already booked instead of raising.
        on conflict do nothing;
      end if;
    end if;
  end if;

  return v_issue;
end;
$$;

revoke all on function public.library_return_book(uuid, numeric) from public, anon;
grant execute on function public.library_return_book(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Reversals must carry the link
-- ---------------------------------------------------------------------------

-- `fees_reverse_entry` copied `invoice_id` but knew nothing about book issues,
-- so reversing a library fine would have produced an entry with no link back
-- to the book -- invisible to the librarian policy above, and unexplainable on
-- the ledger. The unique index deliberately excludes reversals, so carrying
-- the id across does not collide.
create or replace function public.fees_reverse_entry(
  p_entry_id uuid,
  p_reason text
)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_original public.ledger_entries;
  v_reversal public.ledger_entries;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reversal needs a reason';
  end if;

  -- No FOR UPDATE: UPDATE is revoked on this table (see 0023).
  select * into v_original from public.ledger_entries
  where id = p_entry_id and tenant_id = v_tenant_id;

  if v_original.id is null then
    raise exception 'Entry not found';
  end if;
  if v_original.reverses_entry_id is not null then
    raise exception 'That entry is itself a reversal, so it cannot be reversed';
  end if;
  if exists (select 1 from public.ledger_entries where reverses_entry_id = p_entry_id) then
    raise exception 'That entry has already been reversed';
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, book_issue_id, entry_type,
    amount, occurred_at, method, reference, note, reverses_entry_id, recorded_by
  ) values (
    v_original.tenant_id, v_original.session_id, v_original.student_id,
    v_original.invoice_id, v_original.book_issue_id, v_original.entry_type,
    -v_original.amount, now(), v_original.method, v_original.reference,
    'Reversal: ' || trim(p_reason), v_original.id, auth.uid()
  )
  returning * into v_reversal;

  return v_reversal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: fines already assessed against students
-- ---------------------------------------------------------------------------

-- Runs as the migration role, so there is no JWT and RLS is bypassed --
-- tenant and session are therefore named explicitly. `recorded_by` is null:
-- nobody booked these, the migration did, and pretending otherwise would put a
-- false actor in the audit trail.
insert into public.ledger_entries (
  tenant_id, session_id, student_id, entry_type, amount,
  occurred_at, note, book_issue_id
)
select
  bi.tenant_id,
  sess.id,
  m.student_id,
  'fine',
  bi.fine_amount,
  coalesce(bi.returned_at, bi.updated_at),
  'Library fine: ' || coalesce(b.title, 'book') || ' (moved from the library module)',
  bi.id
from public.book_issues bi
join public.members m on m.id = bi.member_id
join public.books b on b.id = bi.book_id
join public.academic_sessions sess
  on sess.tenant_id = bi.tenant_id and sess.is_current
where bi.fine_amount > 0
  and m.student_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Retire the flag the ledger now answers
-- ---------------------------------------------------------------------------

alter table public.book_issues drop column fine_paid;
