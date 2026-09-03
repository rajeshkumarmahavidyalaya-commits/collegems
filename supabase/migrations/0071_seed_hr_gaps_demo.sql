-- Phase 2.3 -- demo data for the four gap fixes, so a fresh deployment shows
-- them working rather than only the tests proving they do.
--
-- Idempotent: it sets a leaving date and reverts nothing that the base HR seed
-- (0062) established. Payroll runs themselves are user actions, not seed data,
-- so this only sets up the *conditions* -- a leaver, and a staff library fine
-- to collect -- that make the features visible when someone runs payroll.

do $$
declare
  v_tenant_id uuid;
  v_staff uuid;
  v_member uuid;
  v_book uuid;
  v_session uuid;
begin
  select id into v_tenant_id from public.tenants where name = 'Rajesh Kumar Mahavidyalaya';
  if v_tenant_id is null then return; end if;

  select id into v_session from public.academic_sessions
  where tenant_id = v_tenant_id and is_current;

  -- A leaver, so payroll demonstrates prorating a partial month. A subject
  -- teacher on the teaching structure, left mid-March.
  update public.staff
  set date_of_leaving = '2026-03-13', status = 'terminated'
  where tenant_id = v_tenant_id and employee_code = 'EMP-015'
    and date_of_leaving is null;

  -- A staff library fine to collect through payroll, if the librarian is a
  -- member and there is a book to lend. Kept small and only created once.
  select m.id into v_member
  from public.members m join public.staff s on s.id = m.staff_id
  where m.tenant_id = v_tenant_id and s.employee_code = 'EMP-005';

  if v_member is not null and v_session is not null then
    select id into v_book from public.books
    where tenant_id = v_tenant_id and available_copies > 0
    order by created_at limit 1;

    if v_book is not null and not exists (
      select 1 from public.book_issues bi
      where bi.member_id = v_member and bi.fine_amount > 0
    ) then
      insert into public.book_issues (
        tenant_id, session_id, book_id, member_id, status,
        issued_at, due_at, returned_at, fine_amount
      )
      values (
        v_tenant_id, v_session, v_book, v_member, 'returned',
        timestamptz '2026-02-02 10:00+05:30', date '2026-02-16',
        timestamptz '2026-02-26 10:00+05:30', 50
      );
    end if;
  end if;
end $$;
