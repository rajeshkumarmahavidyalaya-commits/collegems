-- 0211 — The matrix needs a way back
--
-- `0210`'s critic points at `/settings/permissions`, and that screen is about
-- to exist. Building it turns `role_permissions` from a table only migrations
-- wrote into a table an administrator edits with checkboxes on a Tuesday
-- afternoon — and the moment that is true, one edit can shut the door behind
-- them.
--
-- `users.manage` is what draws the permissions screen. It is held by exactly
-- one role in a new college (`admin`, from `platform_start_school`). Clearing
-- that one checkbox removes the only way back into the matrix, and the product
-- has no other route to it.
--
-- ## Not fatal, and still worth refusing
--
-- The boundary is unaffected: every policy in the schema compares
-- `current_role_code() = 'admin'`, never the matrix, so an administrator
-- keeps every row they had and the college's data is never at risk. What is
-- lost is the *screen* — the college would be one `psql` session away from a
-- product they can no longer administer, and they do not have a psql session.
--
-- ## Why a trigger, and not a check in the write function
--
-- Rule 4's answer for "a rule about how many other rows exist" is a check in
-- the write function under a lock. That works when the function is the only way
-- in — and here it is not: the screen writes through PostgREST with the
-- existing `admins manage role_permissions` policy, and **a plain delete
-- through PostgREST routes around any function** (the lesson `0205` learned
-- about seat limits).
--
-- So it is a `BEFORE` trigger, and it covers DELETE *and* the UPDATE that sets
-- `allowed = false`, because those are the same act with different SQL.
--
-- The message carries the consequence rather than the rule, because somebody
-- meets this while trying to do something reasonable.

begin;

create or replace function public.role_permissions_keep_a_way_back()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_others int;
begin
  -- Only one permission is load-bearing this way. Everything else can be taken
  -- away and given back from the screen that this one permission draws.
  if old.permission_code <> 'users.manage' or not old.allowed then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- An UPDATE that leaves it allowed is not a removal.
  if tg_op = 'UPDATE' and new.permission_code = 'users.manage' and new.allowed then
    return new;
  end if;

  -- SECURITY DEFINER for the reason this codebase already documents about
  -- `subscription_enforce_limit`: an invoker function counting rows counts the
  -- rows the *caller* can see. `role_permissions` is readable tenant-wide, so
  -- an invoker count would in fact be right today — and would silently start
  -- being wrong the day somebody narrows that policy. Count as the definer and
  -- filter by tenant explicitly, which is the one place rule 11's ban on
  -- `where tenant_id =` does not apply.
  select count(*) into v_others
  from public.role_permissions rp
  where rp.tenant_id = old.tenant_id
    and rp.permission_code = 'users.manage'
    and rp.allowed
    and rp.role_id <> old.role_id;

  if v_others = 0 then
    raise exception
      'This is the last role that can open the permissions screen, so taking '
      'it away would leave nobody able to give it back. Grant it to another '
      'role first.'
      using errcode = 'restrict_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.role_permissions_keep_a_way_back() is
  'Refuses the edit that removes the last role holding users.manage. The '
  'permissions screen is the only way into the matrix, and a college with no '
  'role holding users.manage cannot reach it -- nor grant it back.';

drop trigger if exists keep_a_way_back on public.role_permissions;
create trigger keep_a_way_back
  before delete or update on public.role_permissions
  for each row execute function public.role_permissions_keep_a_way_back();

commit;
