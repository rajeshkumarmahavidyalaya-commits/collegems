-- 0348: Tickets and Activities, the reference's SM Tickets and SM Activities.
--
-- Tickets
-- -------
-- A ticket is something to be done about a student: a title, a priority, a
-- status, who it is assigned to and by when. The reference's columns are #,
-- Title, Priority, Status, Subject, Student Name, Class, Role, Assigned To,
-- Due Date, Created On, and a student sees their own under Support Tickets.
--
--   * The administrator writes tickets through the policy.
--   * The member of staff it is assigned to moves its status through
--     `ticket_set_status`, a narrow definer, and has **no update policy**:
--     RLS cannot limit an assignee to the status column (rule 4, "a column
--     grant separates columns, not people"), and an update policy would let
--     them reassign the ticket to somebody else or rewrite what it says.
--   * A family raises a ticket about their own child through `ticket_raise`
--     and reads their child's tickets. No family write policy, deliberately.
--   * The class is frozen at raising: a ticket records a day, not "now"
--     (rule 4, "it carries a fact that is still true").
--
-- Activities
-- ----------
-- An activity (a music club, a coding class) has a name, a class it is for
-- (or every class), a fee, a description and a status. Joining a child raises
-- the fee as a one-off invoice through `fees_raise_charge`, the counter's own
-- charge, so it is billed, paid and receipted like any other (rule 6).
-- Withdrawing ends the participation rather than deleting it (rule 12, "end,
-- do not cancel") and cancels that invoice through `fees_cancel_invoice`; if
-- money has been taken against it, that function refuses and says what to
-- reverse first, and the withdrawal fails with its sentence. One act, not a
-- flag somebody has to remember to follow with a refund.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tickets

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  session_id uuid not null references public.academic_sessions (id),
  title text not null check (length(btrim(title)) between 1 and 150),
  description text check (description is null or length(description) <= 4000),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  student_id uuid not null,
  section_id uuid,
  subject_id uuid,
  assignee_role text check (assignee_role is null or assignee_role in ('admin', 'teacher', 'accountant', 'librarian')),
  assigned_to_staff_id uuid,
  due_on date,
  raised_by uuid not null default auth.uid() references auth.users (id),
  raised_by_family boolean not null default false,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint tickets_student_fkey foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint tickets_section_fkey foreign key (tenant_id, section_id)
    references public.sections (tenant_id, id) on delete set null (section_id),
  constraint tickets_subject_fkey foreign key (tenant_id, subject_id)
    references public.subjects (tenant_id, id) on delete set null (subject_id),
  constraint tickets_assignee_fkey foreign key (tenant_id, assigned_to_staff_id)
    references public.staff (tenant_id, id) on delete set null (assigned_to_staff_id),
  constraint tickets_resolved_chk check ((status in ('resolved', 'closed')) = (resolved_at is not null))
);
create index tickets_tenant_created_idx on public.tickets (tenant_id, created_at desc);
create index tickets_student_idx on public.tickets (student_id);
create index tickets_assignee_idx on public.tickets (assigned_to_staff_id);
create index tickets_section_idx on public.tickets (section_id);
create index tickets_subject_idx on public.tickets (subject_id);
create index tickets_session_idx on public.tickets (session_id);
create index tickets_raised_by_idx on public.tickets (raised_by);

comment on table public.tickets is
  'Something to be done about a student, with a priority, a status, an assignee and a due date. The administrator writes through the policy; the assignee moves status through ticket_set_status; a family raises through ticket_raise (0348).';

create trigger set_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();
create trigger audit_tickets after insert or update or delete on public.tickets
  for each row execute function public.audit_row_change();

alter table public.tickets enable row level security;

create policy "admins manage tickets" on public.tickets
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');
create policy "staff view tickets they hold or raised" on public.tickets
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      raised_by = (select auth.uid())
      or assigned_to_staff_id = (
        select up.staff_id from public.user_profiles up where up.id = (select auth.uid())
      )
    )
  );
create policy "families view their children's tickets" on public.tickets
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select up.student_id from public.user_profiles up
      where up.id = (select auth.uid()) and up.student_id is not null
      union
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );
-- No update policy for the assignee and no insert policy for a family, on
-- purpose: each writes through its own function below.

create function public.ticket_set_status(p_ticket_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_staff uuid;
  v_ticket public.tickets;
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception 'A ticket is open, in progress, resolved or closed.' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'The note is at most 2,000 characters.' using errcode = '22023';
  end if;
  -- Tenant by hand in every read: no policy runs in here.
  select up.staff_id into v_staff from public.user_profiles up where up.id = auth.uid() and up.tenant_id = v_tenant;
  select * into v_ticket from public.tickets t where t.id = p_ticket_id and t.tenant_id = v_tenant;
  if v_ticket.id is null
     or not (public.current_role_code() = 'admin' or (v_staff is not null and v_ticket.assigned_to_staff_id = v_staff)) then
    raise exception 'Only the person a ticket is assigned to, or an administrator, changes its status.' using errcode = '42501';
  end if;

  update public.tickets
  set status = p_status,
      resolution_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), resolution_note),
      resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
  where id = p_ticket_id and tenant_id = v_tenant;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The ticket was not changed.' using errcode = '42501';
  end if;
end;
$$;

comment on function public.ticket_set_status(uuid, text, text) is
  'The assignee (or an administrator) moves a ticket to open, in progress, resolved or closed, with an optional note. DEFINER because the assignee has no update policy: one would let them reassign or rewrite the ticket (0348).';

create function public.ticket_raise(p_student_id uuid, p_title text, p_description text, p_subject_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_section uuid;
  v_id uuid;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.family_owns_student(p_student_id) then
    raise exception 'A family raises a ticket about their own child only.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Give the ticket a title of up to 150 characters.' using errcode = '22023';
  end if;
  if length(coalesce(p_description, '')) > 4000 then
    raise exception 'The description is at most 4,000 characters.' using errcode = '22023';
  end if;
  if p_subject_id is not null and not exists (select 1 from public.subjects s where s.id = p_subject_id and s.tenant_id = v_tenant) then
    raise exception 'That subject is not one of this college''s.' using errcode = '22023';
  end if;
  select s.id into v_session from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current;
  if v_session is null then
    raise exception 'This college has no current academic year.' using errcode = '22023';
  end if;
  select e.section_id into v_section from public.enrolments e
  where e.tenant_id = v_tenant and e.student_id = p_student_id and e.session_id = v_session and e.status = 'active'
  limit 1;

  insert into public.tickets (tenant_id, session_id, title, description, student_id, section_id, subject_id, raised_by, raised_by_family)
  values (v_tenant, v_session, v_title, nullif(btrim(coalesce(p_description, '')), ''), p_student_id, v_section, p_subject_id, auth.uid(), true)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.ticket_raise(uuid, text, text, uuid) is
  'A family raises a ticket about their own child: open, medium priority, unassigned, the class frozen from this year''s enrolment. DEFINER because a family has no insert policy, on purpose; filters by tenant by hand (0348).';

revoke all on function public.ticket_set_status(uuid, text, text) from public, anon;
revoke all on function public.ticket_raise(uuid, text, text, uuid) from public, anon;
grant execute on function public.ticket_set_status(uuid, text, text) to authenticated;
grant execute on function public.ticket_raise(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Activities

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  session_id uuid not null references public.academic_sessions (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  class_level_id uuid,
  fee numeric(12, 2) not null default 0 check (fee >= 0),
  fee_head_id uuid,
  description text check (description is null or length(description) <= 4000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint activities_class_fkey foreign key (tenant_id, class_level_id)
    references public.class_levels (tenant_id, id),
  constraint activities_fee_head_fkey foreign key (tenant_id, fee_head_id)
    references public.fee_heads (tenant_id, id),
  -- A fee is billed under a fee head, so the bill says what it is for.
  constraint activities_fee_head_chk check (fee = 0 or fee_head_id is not null)
);
create unique index activities_name_key on public.activities (tenant_id, session_id, lower(btrim(name)));
create index activities_class_idx on public.activities (class_level_id);
create index activities_fee_head_idx on public.activities (fee_head_id);
create index activities_session_idx on public.activities (session_id);

comment on table public.activities is
  'A college''s activities this year (a club, a class): a fee, the class it is for or every class. Participants are activity_participants (0348).';

create table public.activity_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  activity_id uuid not null,
  student_id uuid not null,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  joined_on date not null default current_date,
  withdrawn_on date,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, student_id),
  constraint activity_participants_activity_fkey foreign key (tenant_id, activity_id)
    references public.activities (tenant_id, id),
  constraint activity_participants_student_fkey foreign key (tenant_id, student_id)
    references public.students (tenant_id, id),
  constraint activity_participants_invoice_fkey foreign key (tenant_id, invoice_id)
    references public.invoices (tenant_id, id),
  constraint activity_participants_withdrawn_chk check ((status = 'withdrawn') = (withdrawn_on is not null))
);
create index activity_participants_student_idx on public.activity_participants (student_id);
create index activity_participants_invoice_idx on public.activity_participants (invoice_id);

comment on table public.activity_participants is
  'Who takes part in an activity. Joining raises the fee as an invoice; withdrawing ends the row and cancels that invoice, never removes it (0348).';

create trigger set_updated_at before update on public.activities
  for each row execute function public.set_updated_at();
create trigger audit_activities after insert or update or delete on public.activities
  for each row execute function public.audit_row_change();
create trigger set_updated_at before update on public.activity_participants
  for each row execute function public.set_updated_at();
create trigger audit_activity_participants after insert or update or delete on public.activity_participants
  for each row execute function public.audit_row_change();

alter table public.activities enable row level security;
alter table public.activity_participants enable row level security;

create policy "tenant members view activities" on public.activities
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage activities" on public.activities
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

create policy "staff view activity participants" on public.activity_participants
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) not in ('parent', 'student')
  );
create policy "families view their children's activities" on public.activity_participants
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select up.student_id from public.user_profiles up
      where up.id = (select auth.uid()) and up.student_id is not null
      union
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );
create policy "admins write activity participants" on public.activity_participants
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

create function public.activity_join(p_activity_id uuid, p_student_id uuid, p_due_date date default null)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_activity public.activities;
  v_part public.activity_participants;
  v_invoice public.invoices;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  -- The policies admit the administrator; an INSERT they refuse raises, so
  -- it is said here first (rule 6).
  if public.current_role_code() is distinct from 'admin' then
    raise exception 'Only an administrator puts a student on an activity.' using errcode = '42501';
  end if;
  select * into v_activity from public.activities a where a.id = p_activity_id;
  if v_activity.id is null or not v_activity.is_active then
    raise exception 'That activity is not open.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.enrolments e
    join public.sections sec on sec.id = e.section_id
    where e.student_id = p_student_id and e.session_id = v_activity.session_id and e.status = 'active'
      and (v_activity.class_level_id is null or sec.class_level_id = v_activity.class_level_id)
  ) then
    raise exception 'That student is not enrolled this year in the class this activity is for.' using errcode = '22023';
  end if;

  select * into v_part from public.activity_participants p
  where p.activity_id = p_activity_id and p.student_id = p_student_id;
  if v_part.id is not null and v_part.status = 'active' then
    return jsonb_build_object('joined', true, 'already', true, 'invoice_id', v_part.invoice_id);
  end if;

  if v_activity.fee > 0 then
    v_invoice := public.fees_raise_charge(
      p_student_id, v_activity.fee, 'Activity: ' || v_activity.name,
      coalesce(p_due_date, current_date + 14), v_activity.fee_head_id);
  end if;

  if v_part.id is null then
    insert into public.activity_participants (tenant_id, activity_id, student_id, invoice_id)
    values (v_tenant, p_activity_id, p_student_id, v_invoice.id)
    returning * into v_part;
  else
    update public.activity_participants
    set status = 'active', joined_on = current_date, withdrawn_on = null, invoice_id = v_invoice.id
    where id = v_part.id
    returning * into v_part;
  end if;
  return jsonb_build_object('joined', true, 'already', false, 'invoice_id', v_part.invoice_id,
                            'invoice_number', v_invoice.invoice_number);
end;
$$;

comment on function public.activity_join(uuid, uuid, date) is
  'Puts a student on an activity this year, raising its fee as an invoice through fees_raise_charge when there is one. A student already on it is not charged twice. INVOKER, administrator only, said before the write (0348).';

create function public.activity_withdraw(p_participant_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_part public.activity_participants;
  v_activity public.activities;
  v_cancelled boolean := false;
  v_rows integer;
begin
  if public.current_role_code() is distinct from 'admin' then
    raise exception 'Only an administrator takes a student off an activity.' using errcode = '42501';
  end if;
  select * into v_part from public.activity_participants p where p.id = p_participant_id;
  if v_part.id is null or v_part.status <> 'active' then
    raise exception 'That student is not on this activity.' using errcode = '22023';
  end if;
  select * into v_activity from public.activities a where a.id = v_part.activity_id;

  -- One act: the fee goes with the place. If money was taken against it,
  -- fees_cancel_invoice refuses and says what to reverse first.
  if v_part.invoice_id is not null
     and exists (select 1 from public.invoices i where i.id = v_part.invoice_id and i.status = 'issued') then
    perform public.fees_cancel_invoice(v_part.invoice_id, 'Withdrawn from ' || v_activity.name);
    v_cancelled := true;
  end if;

  update public.activity_participants
  set status = 'withdrawn', withdrawn_on = current_date
  where id = p_participant_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The student was not taken off the activity.' using errcode = '42501';
  end if;
  return jsonb_build_object('withdrawn', true, 'invoice_cancelled', v_cancelled);
end;
$$;

comment on function public.activity_withdraw(uuid) is
  'Takes a student off an activity: ends the row and cancels its fee invoice in one act; refuses with the invoice''s own sentence if money was taken against it. INVOKER, administrator only (0348).';

revoke all on function public.activity_join(uuid, uuid, date) from public, anon;
revoke all on function public.activity_withdraw(uuid) from public, anon;
grant execute on function public.activity_join(uuid, uuid, date) to authenticated;
grant execute on function public.activity_withdraw(uuid) to authenticated;

commit;
