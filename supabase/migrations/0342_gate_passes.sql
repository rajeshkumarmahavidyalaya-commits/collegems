-- 0342: Gate passes -- the reference's "SM Gate Pass" -- on the visitor log.
--
-- A gate pass is somebody who comes to the gate for a student: a parent
-- collecting a child at noon, an uncle bringing a forgotten lunch. The
-- reference lists Visitor Name, Mobile, Relation, Student, Class, Section,
-- Date, In Time, Out Time and Authorized By.
--
-- This product already has the gate's log: `visitors` (front office), which
-- carries a student, a phone, a numbered pass and the times in and out. A
-- second table for the same people at the same gate would be two answers to
-- "who is in the building", so a gate pass is a visit with a student on it,
-- and it gains the two facts the log did not hold:
--
--   * `relation_to_student` -- mother, driver, uncle; what the visitor says
--     they are to the child. Their own words, not a guardian link: somebody at
--     the gate is often not on the child's record, which is the reason a pass
--     names who authorised it.
--   * `authorized_by` -- the person at the school who allowed it, as written.
--     Text, not a staff id, because it is often the principal on the phone or
--     a class teacher's name the guard writes down.
--
-- The times are the log's own: In Time is when the pass was issued and Out
-- Time when the visitor was signed out. They are never typed, because a gate
-- register whose times can be written in afterwards is not a record of when.
--
-- `gate_pass_issue` checks the visitor in through `visitor_check_in`, the one
-- definition of a visit (its numbering, its year, its one-open-pass-per-phone
-- rule), then writes the two new facts and checks that row count. INVOKER: the
-- front-office policy on `visitors` is the gate, as for every visit.
--
-- `gate_pass_register` is the list: this year's visits that name a student,
-- newest first, with the child's class and section. INVOKER over the same
-- policy.
--
-- Also: `class_group_save` (0341) refused a role without the administrator
-- policy with Postgres's own words on its INSERT. An INSERT whose WITH CHECK
-- fails raises rather than writing nothing (rule 6), so the check goes before
-- it and says what it refuses.

begin;

alter table public.visitors
  add column relation_to_student text,
  add column authorized_by text;

alter table public.visitors
  add constraint visitors_relation_chk
    check (relation_to_student is null or length(btrim(relation_to_student)) between 1 and 60),
  add constraint visitors_authorized_by_chk
    check (authorized_by is null or length(btrim(authorized_by)) between 1 and 120);

comment on column public.visitors.relation_to_student is
  'What the visitor is to the student on the pass, in their words (mother, driver). Gate passes, 0342.';
comment on column public.visitors.authorized_by is
  'Who at the school allowed the gate pass, as written. Gate passes, 0342.';

create function public.gate_pass_issue(
  p_student_id uuid,
  p_visitor_name text,
  p_phone text,
  p_relation text,
  p_authorized_by text,
  p_reason text default null
)
returns public.visitors
language plpgsql
set search_path = public, extensions
as $$
declare
  v_row public.visitors;
  v_count integer;
begin
  if p_student_id is null then
    raise exception 'A gate pass is for a student: choose the student.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'That student is not on this college''s roll.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_relation, ''))) = 0 then
    raise exception 'Say what the visitor is to the student (mother, driver).' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_authorized_by, ''))) = 0 then
    raise exception 'Say who at the school allowed this pass.' using errcode = '22023';
  end if;

  v_row := public.visitor_check_in(
    p_visitor_name,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'To see a student (gate pass)'),
    p_phone,
    null, null, null,
    p_student_id
  );

  update public.visitors
  set relation_to_student = btrim(p_relation),
      authorized_by = btrim(p_authorized_by)
  where id = v_row.id
  returning * into v_row;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'The pass was not written. Gate passes are issued by the front office.'
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

comment on function public.gate_pass_issue(uuid, text, text, text, text, text) is
  'Issues a gate pass: a visit, through visitor_check_in, that names a student, the visitor''s relation to them and who allowed it. INVOKER: the front-office policy on visitors is the gate (0342).';

create function public.gate_pass_register(p_limit integer default 500)
returns table (
  id uuid,
  pass_number text,
  visitor_name text,
  phone text,
  relation_to_student text,
  student_id uuid,
  student_name text,
  admission_number text,
  class_name text,
  section_name text,
  purpose text,
  authorized_by text,
  checked_in_at timestamptz,
  checked_out_at timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select
    v.id,
    v.pass_number,
    v.visitor_name,
    v.phone,
    v.relation_to_student,
    v.student_id,
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    s.admission_number,
    (select cl.name
       from public.enrolments e
       join public.sections sec on sec.id = e.section_id
       join public.class_levels cl on cl.id = sec.class_level_id
      where e.student_id = v.student_id and e.session_id = v.session_id
      order by e.status = 'active' desc
      limit 1),
    (select sec.name
       from public.enrolments e
       join public.sections sec on sec.id = e.section_id
      where e.student_id = v.student_id and e.session_id = v.session_id
      order by e.status = 'active' desc
      limit 1),
    v.purpose,
    v.authorized_by,
    v.checked_in_at,
    v.checked_out_at
  from public.visitors v
  left join public.students s on s.id = v.student_id
  left join public.people p on p.id = s.person_id
  where v.student_id is not null
    and v.session_id = public.current_session_id(public.current_tenant_id())
  order by v.checked_in_at desc, v.id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

comment on function public.gate_pass_register(integer) is
  'This year''s gate passes, newest first: visits that name a student, with the child''s class and section in the year of the visit. Bounded (500 by default, 2000 at most). INVOKER over the front-office policy on visitors (0342).';

create or replace function public.class_group_save(
  p_id uuid,
  p_name text,
  p_head_staff_id uuid,
  p_class_level_ids uuid[]
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_wanted integer := (select count(distinct x) from unnest(coalesce(p_class_level_ids, '{}')) x);
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  -- The policies on class_groups and class_levels admit the administrator;
  -- said here, before the INSERT, because a refused INSERT raises Postgres's
  -- words rather than writing nothing (rule 6).
  if public.current_role_code() is distinct from 'admin' then
    raise exception 'Only an administrator can change class groups.' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Give the group a name of up to 80 characters.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.class_groups (tenant_id, name, head_staff_id)
    values (v_tenant, v_name, p_head_staff_id)
    returning id into v_id;
  else
    update public.class_groups
    set name = v_name, head_staff_id = p_head_staff_id
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That class group does not exist.' using errcode = '42501';
    end if;
  end if;

  update public.class_levels
  set class_group_id = null
  where class_group_id = v_id
    and not (id = any (coalesce(p_class_level_ids, '{}')));

  if v_wanted > 0 then
    update public.class_levels
    set class_group_id = v_id
    where id = any (p_class_level_ids)
      and class_group_id is distinct from v_id;
    select count(*) into v_rows
    from public.class_levels
    where id = any (p_class_level_ids) and class_group_id = v_id;
    if v_rows <> v_wanted then
      raise exception 'Only this college''s classes can be put in a group.' using errcode = '42501';
    end if;
  end if;

  return v_id;
end;
$$;

commit;
