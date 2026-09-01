-- Attendance.
--
-- Session-scoped and keyed to `enrolments`, not `students`: attendance belongs
-- to a student's place in a section for a given year, which is what makes a
-- transferred or repeating student's history stay attached to the right class.
--
-- `period` is `integer not null default 0`, where 0 means whole-day. The
-- roadmap's period-wise marking needs the timetable tables, which do not exist
-- yet -- but modelling it as a NOT NULL column now means the unique key is a
-- plain 4-column index rather than one over `coalesce(period, -1)`, and
-- period-wise marking later is a data change, not a migration of the key.

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  attendance_date date not null,
  period integer not null default 0 check (period >= 0),
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  note text,
  marked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One record per enrolment per date per period. This is what makes marking
-- idempotent: a phone that lost connectivity and replays its queue upserts
-- onto the same row instead of double-marking.
create unique index attendance_records_unique_mark
  on public.attendance_records (tenant_id, enrolment_id, attendance_date, period);

create index attendance_records_tenant_idx on public.attendance_records (tenant_id);
create index attendance_records_session_date_idx
  on public.attendance_records (tenant_id, session_id, attendance_date);
create index attendance_records_enrolment_idx on public.attendance_records (enrolment_id);
create index attendance_records_marked_by_idx on public.attendance_records (marked_by);
create index attendance_records_absent_idx
  on public.attendance_records (tenant_id, attendance_date)
  where status in ('absent', 'late');

create trigger set_updated_at before update on public.attendance_records
  for each row execute function public.set_updated_at();

create trigger audit_attendance_records
  after insert or update or delete on public.attendance_records
  for each row execute function public.audit_row_change();

alter table public.attendance_records enable row level security;

create policy "staff roles view attendance" on public.attendance_records
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "admins manage attendance" on public.attendance_records
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- A teacher can see and mark attendance only for enrolments in sections they
-- are the class teacher of. This is the security boundary; the UI hiding the
-- marking screen is not.
create policy "teachers view own section attendance" on public.attendance_records
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and enrolment_id in (
      select e.id from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  );

create policy "teachers mark own section attendance" on public.attendance_records
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and enrolment_id in (
      select e.id from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and enrolment_id in (
      select e.id from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  );

create policy "students view own attendance" on public.attendance_records
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and enrolment_id in (
      select e.id from public.enrolments e
      where e.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  );

create policy "parents view own children attendance" on public.attendance_records
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and enrolment_id in (
      select e.id from public.enrolments e
      join public.guardian_student gs on gs.student_id = e.student_id
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

-- Marking a class is one write per student. As separate client calls a dropped
-- connection leaves half a register marked, and a replayed offline queue can
-- race itself. One upsert instead -- idempotent by the unique key above, so
-- replaying the same payload converges rather than duplicating.
--
-- SECURITY INVOKER: runs as the calling teacher, so the policies above still
-- decide which enrolments they may touch. The function only adds atomicity.
create or replace function public.mark_attendance(
  p_section_id uuid,
  p_date date,
  p_entries jsonb,
  p_period integer default 0
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_written integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if p_date > current_date then
    raise exception 'Cannot mark attendance for a future date';
  end if;

  with entries as (
    select
      (e ->> 'enrolment_id')::uuid as enrolment_id,
      e ->> 'status' as status,
      nullif(trim(coalesce(e ->> 'note', '')), '') as note
    from jsonb_array_elements(p_entries) as e
  ),
  -- Only enrolments that really belong to this section in this session get
  -- written, so a tampered payload cannot mark another class's register.
  valid as (
    select en.enrolment_id, en.status, en.note
    from entries en
    join public.enrolments enr on enr.id = en.enrolment_id
    where enr.tenant_id = v_tenant_id
      and enr.section_id = p_section_id
      and enr.session_id = v_session_id
  ),
  upserted as (
    insert into public.attendance_records
      (tenant_id, session_id, enrolment_id, attendance_date, period, status, note, marked_by)
    select v_tenant_id, v_session_id, v.enrolment_id, p_date, p_period, v.status, v.note, auth.uid()
    from valid v
    on conflict (tenant_id, enrolment_id, attendance_date, period) do update
      set status = excluded.status,
          note = excluded.note,
          marked_by = excluded.marked_by
    returning 1
  )
  select count(*) into v_written from upserted;

  return v_written;
end;
$$;

revoke all on function public.mark_attendance(uuid, date, jsonb, integer) from public, anon;
grant execute on function public.mark_attendance(uuid, date, jsonb, integer) to authenticated;
