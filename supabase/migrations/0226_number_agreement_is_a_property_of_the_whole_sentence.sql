-- 0226 -- "reaches those family"
--
-- `0224`'s critic, probed on the demo college, said:
--
--   302 of 302 active students have nobody who can sign in: no fee account,
--   timetable, result or absence notice reaches those family.
--
-- The subject agrees, the verb agrees, and the last noun does not. That is the
-- error `0196` already paid two migrations to learn, quoted in CLAUDE.md:
--
-- > **Number agreement is a property of the whole sentence.** Fixing the
-- > subject and the verb and leaving the pronoun is not a partial fix; it is
-- > the same error one clause later, and on a screen whose only purpose is to
-- > be acted on it reads exactly as careless.
--
-- Written by somebody who had read that paragraph, which is the useful part:
-- the rule is not hard to state and is easy to half-apply, because the first
-- two agreements are the ones you are looking at while you write the `case`.
--
-- And a second agreement the first draft got wrong by not noticing there were
-- **two counts in one sentence**. `%s of %s active student(s) has/have` — the
-- noun agrees with the total and the verb agrees with the numerator:
--
--     1 of 302 active students has ...
--   302 of 302 active students have ...
--     1 of 1   active student  has ...
--
-- Both forms are carried rather than derived, because English plurals are not
-- derivable and "family"/"families" is exactly the pair that proves it.

begin;

create or replace function public.family_login_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_total integer;
  v_without integer;
  v_stale integer;
begin
  if not public.role_has_permission('users.manage') then
    return;
  end if;

  select count(*) into v_total from public.students s where s.status = 'active';

  select count(*) into v_without
  from public.students s
  where s.status = 'active'
    and not exists (
      select 1 from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where gs.student_id = s.id)
    and not exists (
      select 1 from public.user_profiles up where up.student_id = s.id);

  if v_without > 0 then
    return query select
      'family.no_login',
      case when v_total > 0 and v_without = v_total then 'warn' else 'info' end,
      format(
        '%s of %s active %s %s nobody who can sign in: no fee account, timetable, result or absence notice reaches %s.',
        v_without,
        v_total,
        case when v_total   = 1 then 'student' else 'students' end,
        case when v_without = 1 then 'has'     else 'have'     end,
        case when v_without = 1 then 'that child''s family' else 'their families' end);
  end if;

  select count(*) into v_stale
  from public.invitations i
  where i.status = 'pending' and i.expires_at <= now();

  if v_stale > 0 then
    return query select
      'family.stale_invitations',
      'info',
      format('%s %s expired without being accepted. %s to be sent again.',
        v_stale,
        case when v_stale = 1 then 'invitation has' else 'invitations have' end,
        case when v_stale = 1 then 'It needs'       else 'They need'        end);
  end if;
end;
$$;

comment on function public.family_login_problems() is
  'Names the children whose family cannot sign in, and invitations that expired '
  'unaccepted. Silent once every family has a login.';

commit;
