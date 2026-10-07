-- 0351: The students of one class a member of staff may chat with.
--
-- The reference's Start Chat form picks a class and section, then students.
-- A subject teacher cannot read a class's enrolments (0304), so listing the
-- class through RLS would show them nobody; `chat_start` would then accept the
-- same children it was never shown. This is the list `chat_start` checks
-- against (`chat_reachable_students`), narrowed to one class, with whether
-- each child has a login, because a child with none cannot be added.

begin;

create function public.chat_reachable_in_section(p_section_id uuid)
returns table (student_id uuid, full_name text, admission_number text, has_login boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if public.current_role_code() not in ('admin', 'teacher') then
    raise exception 'A teacher or an administrator starts a chat with students.' using errcode = '42501';
  end if;
  return query
  select st.id,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         st.admission_number,
         exists (select 1 from public.user_profiles up where up.student_id = st.id and up.tenant_id = v_tenant)
  from public.chat_reachable_students(v_tenant, auth.uid()) r
  join public.students st on st.id = r.student_id and st.tenant_id = v_tenant
  join public.people p on p.id = st.person_id
  join public.enrolments e on e.student_id = st.id and e.tenant_id = v_tenant and e.status = 'active'
    and e.section_id = p_section_id
    and e.session_id = (select s.id from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current)
  order by 2, st.admission_number, st.id;
end;
$$;

comment on function public.chat_reachable_in_section(uuid) is
  'The students of one class this year that the caller may start a chat with (chat_reachable_students), with whether each has a login. DEFINER: a subject teacher cannot read a class''s enrolments (0304). Name and admission number only (0351).';

revoke all on function public.chat_reachable_in_section(uuid) from public, anon;
grant execute on function public.chat_reachable_in_section(uuid) to authenticated;

commit;
