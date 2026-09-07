-- ---------------------------------------------------------------------------
-- Deleting the other four copies of 2.00
-- ---------------------------------------------------------------------------
--
-- Migration `0101` did this once already, for the list of document kinds:
-- `fees_next_document_number_for` carried its own copy of which kinds exist
-- beside the CHECK that already said so, and `0073` had then hand-copied the
-- whole numberer into `accounts_next_voucher_number`. The rule that came out of
-- it is in CLAUDE.md's conventions, and it applies here word for word with
-- "default" in place of "list of valid values".
--
-- `library.fine_per_day` defaults to 2.00 in five places:
--
--   1. the seeded settings row                          `0026`
--   2. `library_return_book`'s coalesce                 `0026`  <- rewritten
--   3. `report_library_overdue`'s coalesce              `0044`  <- rewritten
--   4. `library_return_book`'s old p_fine_per_day arg   `0015`  (superseded)
--   5. `getFinePerDay()` in TypeScript                          <- rewritten
--
-- Nobody is charged wrongly today: all three live readers consult the tenant's
-- row first and only fall back. The cost is the one `0101` paid -- changing the
-- default means finding five copies, and the sixth reader somebody writes next
-- year invents its own. `0044`'s own comment admits the duplication out loud
-- ("The same coalesce chain as `library_return_book`, including its 2.00
-- fallback") which is the shape of a problem that has been noticed and not
-- fixed.
--
-- `setting_number('library.fine_per_day', 'amount')` is now the only reader,
-- and `reference.settings_catalog.default_value` the only default.
--
-- EQUIVALENCE, AND HOW IT WAS CHECKED
--
-- `library_return_book` already computed its tenant as
-- `public.current_tenant_id()`, which is exactly what `setting_value` uses, so
-- the substitution is literal. The report filtered on `bi.tenant_id`, which
-- under RLS is the caller's tenant for every row it can see -- the same value,
-- reached differently.
--
-- Verified numerically before and after against the demo tenant, because this
-- is a money path and rule 12's payroll lesson is that only the arithmetic
-- finds an error like this:
--
--     report_run('library.overdue') -> 5 rows, estimated fine total 130.00
--
-- ...with the same 5 rows and the same 130.00 required afterwards.
-- `p_fine_per_day` stays on `library_return_book`: an explicit argument still
-- wins, which is what lets a librarian waive down to a different rate on one
-- return without changing the school's setting.

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

  -- An explicit argument still wins -- that is how a librarian waives down on
  -- one return. Otherwise `setting_number` resolves it: the tenant's row, else
  -- the catalogue default. No literal here, and none anywhere else.
  v_rate := coalesce(
    p_fine_per_day,
    public.setting_number('library.fine_per_day', 'amount')
  );

  v_days_late := greatest(0, (current_date - v_issue.due_at));
  v_fine := v_days_late * v_rate;

  update public.book_issues
  set status = 'returned',
      returned_at = current_date,
      fine_amount = v_fine
  where id = p_issue_id
  returning * into v_issue;

  if v_fine > 0 then
    select m.student_id into v_student_id from public.members m where m.id = v_issue.member_id;
    select b.title into v_title from public.books b where b.id = v_issue.book_id;

    if v_student_id is not null then
      v_session_id := public.current_session_id(v_tenant_id);

      insert into public.ledger_entries (
        tenant_id, session_id, student_id, entry_type, amount,
        description, book_issue_id, created_by
      )
      values (
        v_tenant_id, v_session_id, v_student_id, 'fine', v_fine,
        format('Library fine: %s (%s days late)', coalesce(v_title, 'book'), v_days_late),
        v_issue.id, ( select auth.uid() )
      )
      on conflict do nothing;
    end if;
  end if;

  return v_issue;
end;
$$;

revoke all on function public.library_return_book(uuid, numeric) from public, anon;
grant execute on function public.library_return_book(uuid, numeric) to authenticated;

create or replace function public.report_library_overdue(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      b.title,
      b.author,
      b.isbn,
      m.membership_number,
      coalesce(
        (sp.first_name || ' ' || sp.last_name),
        (fp.first_name || ' ' || fp.last_name)
      ) as borrower,
      case when m.student_id is not null then 'Student' else 'Staff' end as borrower_type,
      st.admission_number,
      bi.issued_at,
      bi.due_at,
      (current_date - bi.due_at)::integer as days_overdue,
      -- The estimate has to come from the same place as the charge, or the
      -- screen and the receipt disagree. Now they read one function.
      round(
        (current_date - bi.due_at)
        * public.setting_number('library.fine_per_day', 'amount'),
        2
      ) as estimated_fine
    from public.book_issues bi
    join public.books b on b.id = bi.book_id
    join public.members m on m.id = bi.member_id
    left join public.students st on st.id = m.student_id
    left join public.people sp on sp.id = st.person_id
    left join public.staff sf on sf.id = m.staff_id
    left join public.people fp on fp.id = sf.person_id
    where bi.status = 'issued'
      and bi.due_at < current_date
      and (current_date - bi.due_at) >= public.report_param_numeric(p_params, 'min_days', 1)
    order by bi.due_at
  ) t
$$;

revoke all on function public.report_library_overdue(jsonb) from public, anon;
grant execute on function public.report_library_overdue(jsonb) to authenticated;
