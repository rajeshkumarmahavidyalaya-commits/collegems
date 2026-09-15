-- 0237 -- A list you cannot act from is a list you re-type.
--
-- `0235` gave the critic its list: **Families who cannot sign in** names every
-- child whose family has no way into the app, worst first, with what is in the
-- way on each row. `0236` stopped the importer creating more of them.
--
-- Neither helped with the 301 that already exist, and re-importing is not the
-- repair — the guardian card on `/students/[id]` is. So the office's actual
-- afternoon is: read a name off a report, copy the admission number, open the
-- students screen, paste, open the child, fix the guardian, go back. **Three
-- hundred and one times.**
--
-- > A report that names a row and cannot reach it has moved the work rather
-- > than done it. `/reports` renders any catalogue row without being edited,
-- > which is rule 11's whole bargain — and it renders every cell as text.
--
-- ## The destination belongs to the report, not to the table
--
-- The obvious fix is a `case` in the renderer: *if the report is
-- `users.family_logins`, link the student column to `/students/…`.* That is a
-- second place to keep a fact the catalogue already holds, and it is wrong on
-- its second use: a child on **Fee defaulters** should open their fee account,
-- not their record. Same column, same name, different destination, decided by
-- which question was asked.
--
-- So `reference.reports.columns` gains an optional `href`, a path with `{key}`
-- placeholders filled from the row:
--
--     {"key": "student", "type": "text", "label": "Student",
--      "href": "/students/{student_id}"}
--
-- ## …and the id is in the row without being a column
--
-- `student_id` is added to each function's projection and to **none** of the
-- descriptors. The table and the CSV are both built from `columns`, so an
-- undeclared key is carried to the renderer and dropped from the export
-- automatically — the office gets a link, and the spreadsheet they send to the
-- fee committee does not grow a uuid column nobody asked for.
--
-- Three reports, because a mechanism with one user is a mechanism nobody
-- maintains, and these are the three an office acts from rather than reads:
--
--     users.family_logins  → /students/{student_id}        the guardian card
--     students.roster      → /students/{student_id}        the record
--     fees.defaulters      → /fees/students/{student_id}   the account
--
-- Everything else in the catalogue is unchanged and renders exactly as before:
-- `href` is optional and absent means text, which is what nineteen of the
-- twenty reports still are.
--
-- ## One thing measured on the way past
--
-- `students.roster` has had a **Student phone** column since it was written,
-- and `people.phone` for a student was written by nothing until `0236` gave the
-- importer a heading for it. So that column has rendered `—` for every child in
-- this college since the day it shipped. Not a defect introduced here and not
-- one this migration fixes — `0236` gave it a source, and the rows already
-- imported still have none.

begin;

-- ---------------------------------------------------------------------------
-- The id travels with the row
-- ---------------------------------------------------------------------------

create or replace function public.report_family_logins(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select to_jsonb(t)
  from (
    select
      -- Not a declared column: the renderer fills `{student_id}` from it and
      -- the exporter, which builds from the descriptors, never sees it.
      f.student_id,
      f.admission_number,
      f.full_name as student,
      f.section_label as class,
      f.guardian_count as guardians,
      f.contact_name as contact,
      f.contact_email as email,
      f.contact_phone as phone,
      case f.state
        when 'no_guardian'  then 'No guardian linked'
        when 'no_address'   then 'No email or phone on any guardian'
        when 'not_invited'  then 'Nobody has been invited yet'
        when 'invited'      then 'Invited, waiting'
        when 'expired'      then 'Invitation expired'
        else f.state
      end as state
    from public.family_login_status(public.report_param_uuid(p_params, 'section')) f
    where f.state <> 'ok'
      and (
        public.report_param_text(p_params, 'state', null) is null
        or f.state = public.report_param_text(p_params, 'state', null)
      )
  ) t
$$;

create or replace function public.report_student_roster(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select to_jsonb(t)
  from (
    select
      st.id as student_id,
      st.admission_number,
      (p.first_name || ' ' || p.last_name) as student,
      (cl.name || ' ' || s.name) as class,
      e.roll_number,
      p.gender,
      p.date_of_birth,
      p.phone as student_phone,
      g.guardian_name,
      g.relationship,
      g.guardian_phone
    from public.enrolments e
    join public.students st on st.id = e.student_id
    join public.people p on p.id = st.person_id
    join public.sections s on s.id = e.section_id
    join public.class_levels cl on cl.id = s.class_level_id
    left join lateral (
      select
        (gp.first_name || ' ' || gp.last_name) as guardian_name,
        gs.relationship,
        gp.phone as guardian_phone
      from public.guardian_student gs
      join public.guardians gu on gu.id = gs.guardian_id
      join public.people gp on gp.id = gu.person_id
      where gs.student_id = st.id
      order by gs.is_primary desc, gp.first_name
      limit 1
    ) g on true
    where e.session_id = ( select public.current_session_id(public.current_tenant_id()) )
      and e.status = coalesce(public.report_param_text(p_params, 'status', 'active'), 'active')
      and (
        public.report_param_uuid(p_params, 'section_id') is null
        or e.section_id = public.report_param_uuid(p_params, 'section_id')
      )
    order by cl.name, s.name, e.roll_number, p.first_name
  ) t
$$;

create or replace function public.report_fee_defaulters(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select to_jsonb(t)
  from (
    select
      b.student_id,
      b.admission_number,
      b.full_name          as student,
      b.section_label      as class,
      b.roll_number,
      b.charged + b.fines  as billed,
      b.discounts + b.write_offs as relieved,
      b.paid,
      b.balance            as outstanding,
      b.last_payment_at
    from public.fees_student_balances(
      public.report_param_uuid(p_params, 'section_id'),
      true,
      null
    ) b
    where b.balance >= public.report_param_numeric(p_params, 'min_amount', 0.01)
    order by b.balance desc, b.full_name
  ) t
$$;

-- ---------------------------------------------------------------------------
-- ...and the catalogue says where it goes
-- ---------------------------------------------------------------------------

update reference.reports
set columns = (
  select jsonb_agg(
    case when c ->> 'key' = 'student'
         then c || jsonb_build_object('href', '/students/{student_id}')
         else c end
    order by ord)
  from jsonb_array_elements(columns) with ordinality as e(c, ord)
)
where key in ('users.family_logins', 'students.roster');

update reference.reports
set columns = (
  select jsonb_agg(
    case when c ->> 'key' = 'student'
         -- The account, not the record. Somebody reading this list is chasing
         -- money, and the screen that takes it is one click away or it is not.
         then c || jsonb_build_object('href', '/fees/students/{student_id}')
         else c end
    order by ord)
  from jsonb_array_elements(columns) with ordinality as e(c, ord)
)
where key = 'fees.defaulters';

commit;
