-- 0275: a subject is taught to a class, so adding one asks which.
--
-- `subjects` is the college's catalogue and `section_subjects` is what puts a
-- subject in front of a class for a year (0031). Until now the two were
-- written from two different tabs: *Subjects* made the row, and *Who teaches
-- what* had to be visited separately, once per class, before the subject
-- appeared on any timetable, register, mark sheet or syllabus. A subject
-- added and never assigned was on no screen that mattered, and nothing said
-- so.
--
-- So adding a subject now names its classes, and the two writes are one
-- function: supabase-js cannot open a transaction, and a subject saved with
-- half its classes is exactly the state this exists to prevent (conventions:
-- multi-step writes that must be atomic go in a Postgres function).
--
-- SECURITY INVOKER, deliberately. Both tables carry "admins manage ..."
-- policies and those remain the boundary. The role check below mirrors them
-- for the *message*, not for the enforcement: an INSERT whose WITH CHECK fails
-- raises "new row violates row-level security policy", which is not a
-- sentence (rule 6, 0257).
--
-- The classes are this year's: `session_id` comes from
-- `current_session_id()`, never from the caller (rule 2), and a section from
-- another year is refused by name rather than filed under this one. Editing a
-- subject is unchanged -- which classes study it is still edited on *Who
-- teaches what*, where a teacher is chosen per class.

create or replace function public.academics_add_subject(
  p_name text,
  p_code text,
  p_kind text,
  p_is_active boolean,
  p_section_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_wanted int;
  v_found int;
  v_subject uuid;
  v_linked int;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college to add a subject.' using errcode = '42501';
  end if;
  if (select public.current_role_code()) is distinct from 'admin' then
    raise exception 'Only an administrator can add a subject.' using errcode = '42501';
  end if;

  select count(distinct s) into v_wanted from unnest(p_section_ids) s where s is not null;
  if v_wanted = 0 then
    raise exception 'Choose at least one class that studies this subject.' using errcode = '22023';
  end if;

  v_session := public.current_session_id(v_tenant);
  if v_session is null then
    raise exception 'This college has no current academic year, so there are no classes to add the subject to.'
      using errcode = '22023';
  end if;

  select count(*) into v_found
  from public.sections sec
  where sec.id = any (p_section_ids)
    and sec.session_id = v_session;
  if v_found <> v_wanted then
    raise exception 'One of the chosen classes is not in the current academic year. Reload the page and choose again.'
      using errcode = '22023';
  end if;

  insert into public.subjects (tenant_id, name, code, kind, is_active)
  values (v_tenant, trim(p_name), upper(trim(p_code)), p_kind, coalesce(p_is_active, true))
  returning id into v_subject;

  insert into public.section_subjects (tenant_id, session_id, section_id, subject_id)
  select v_tenant, v_session, s, v_subject
  from (select distinct s from unnest(p_section_ids) s where s is not null) d;

  -- An INSERT that a policy refuses raises, so this is not the refusal; it is
  -- the check that every class chosen was actually linked.
  get diagnostics v_linked = row_count;
  if v_linked <> v_wanted then
    raise exception 'The subject could not be added to every class chosen (% of %).', v_linked, v_wanted;
  end if;

  return v_subject;
end;
$$;

comment on function public.academics_add_subject(text, text, text, boolean, uuid[]) is
  'Adds a subject and puts it in front of the chosen classes of the current year, in one transaction. Invoker: the admins-manage policies on subjects and section_subjects are the boundary.';

-- Invoker, so an anonymous caller could do nothing with it; revoked anyway so
-- the publishable key does not list it (0267's habit, not its necessity).
revoke all on function public.academics_add_subject(text, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.academics_add_subject(text, text, text, boolean, uuid[]) to authenticated;
