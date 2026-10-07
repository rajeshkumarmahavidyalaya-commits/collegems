-- 0352: a chat names an administrator.
--
-- chat_display_name (0350) found a name through the staff, student or
-- guardian record and never through user_profiles.person_id, which is where
-- an administrator with no staff record keeps theirs (the header reads it
-- there). Walked in the Annex: the administrator's message reached a student
-- signed "A member of the college". It now reads the profile's own person
-- first, and a login with no person at all is named by its role, which says
-- who is writing without publishing an email address.
--
-- create or replace keeps the function's grants: revoked from every JWT role,
-- called only inside the chat read models.

create or replace function public.chat_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    r.name,
    'A member of the college'
  )
  from public.user_profiles up
  left join public.roles r on r.id = up.role_id and r.tenant_id = up.tenant_id
  left join public.staff st on st.id = up.staff_id
  left join public.students stu on stu.id = up.student_id
  left join public.guardians g on g.id = up.guardian_id
  left join public.people p
    on p.id = coalesce(up.person_id, st.person_id, stu.person_id, g.person_id)
  where up.id = p_user and up.tenant_id = public.current_tenant_id();
$$;

comment on function public.chat_display_name(uuid) is
  'The name a login shows in a chat, in the caller''s own college: the profile''s person, else the record''s, else the role (0352). Called only inside the chat read models; not executable by any JWT role (0350).';
