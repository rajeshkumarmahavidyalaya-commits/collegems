-- An invitation only has to name whichever of staff_id/student_id/guardian_id
-- applies; person_id was being left null even though it's always derivable
-- from one of those. Resolve it in the trigger, and backfill the one profile
-- created before this fix (the seeded demo admin).

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  role_code text;
  resolved_person_id uuid;
begin
  select * into inv
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if inv.id is null then
    return new;
  end if;

  select code into role_code from public.roles where id = inv.role_id;

  resolved_person_id := inv.person_id;
  if resolved_person_id is null and inv.staff_id is not null then
    select person_id into resolved_person_id from public.staff where id = inv.staff_id;
  end if;
  if resolved_person_id is null and inv.student_id is not null then
    select person_id into resolved_person_id from public.students where id = inv.student_id;
  end if;
  if resolved_person_id is null and inv.guardian_id is not null then
    select person_id into resolved_person_id from public.guardians where id = inv.guardian_id;
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', inv.tenant_id, 'role', role_code)
  where id = new.id;

  insert into public.user_profiles (id, tenant_id, role_id, person_id, student_id, staff_id, guardian_id)
  values (new.id, inv.tenant_id, inv.role_id, resolved_person_id, inv.student_id, inv.staff_id, inv.guardian_id);

  update public.invitations
  set status = 'accepted', accepted_at = now()
  where id = inv.id;

  return new;
end;
$$;

update public.user_profiles up
set person_id = s.person_id
from public.staff s
where up.staff_id = s.id and up.person_id is null;
