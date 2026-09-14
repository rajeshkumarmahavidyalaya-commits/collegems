-- 0232 -- A preview of five hundred families.
--
-- `0231` is the run and its rows; this is the two things that fill and empty
-- them. Rule 13's sentences, with the numbers this module produces:
--
--   * **the preview materialises as rows a person can edit** -- every list of
--     555 has a handful the rules get wrong, and the person who knows which is
--     standing at the screen;
--   * **apply through the module's own write function**, so
--     `invitation_create` decides what an invitation is for both callers;
--   * **apply partially and record why** -- a failed row keeps its reason and
--     the batch carries on;
--   * **refuse an oversized input rather than truncating it**, because
--     silently inviting the first 500 of 900 families is the worst available
--     outcome: nobody notices until April.
--
-- ## The preview decides nothing a person cannot see
--
-- Every row arrives as `invite` or `skip` **with the reason on it**, and the
-- three reasons to skip are all facts the office would otherwise have to
-- discover one at a time:
--
--   no address        -- there is nothing to send to
--   already has a login -- inviting again makes a second account, silently
--   already invited   -- a pending invitation is waiting; re-sending is the
--                        *Send again* button, not a second row
--
-- None of them is a refusal. A person can turn any skip into an invite by
-- typing an address or deciding they want a second login, and `is_override`
-- records that they did -- the difference between *"the rules decided"* and
-- *"the office decided"*, which is what an audit trail is for.

begin;

create or replace function public.invitation_preview(
  p_role_id uuid,
  p_section_id uuid default null
)
returns public.invitation_runs
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_subject text;
  v_run public.invitation_runs;
  v_count integer;
  v_max constant integer := 1000;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot invite people to this school.';
  end if;

  select r.subject into v_subject
  from public.roles r where r.id = p_role_id and r.tenant_id = v_tenant_id;

  if v_subject is null then
    raise exception 'That role does not belong to this school.';
  end if;

  if v_subject = 'none' then
    raise exception 'That role stands for nobody, so there is no list to build.';
  end if;

  -- Rule 13's one-live-run index would refuse this with `23505`, which is not
  -- a sentence. Say what is in the way and what to do about it.
  if exists (select 1 from public.invitation_runs
              where tenant_id = v_tenant_id and status = 'draft') then
    raise exception 'There is already an invitation list waiting. Finish or discard it first — two half-corrected lists of the same people disagree.';
  end if;

  insert into public.invitation_runs (tenant_id, role_id, section_id, created_by)
  values (v_tenant_id, p_role_id, p_section_id, auth.uid())
  returning * into v_run;

  if v_subject = 'guardian' then
    insert into public.invitation_decisions (
      tenant_id, run_id, guardian_id, full_name, email, decision, reason)
    select
      v_tenant_id, v_run.id, c.guardian_id, c.full_name, c.email,
      case when c.email is null or c.has_login or c.pending then 'skip' else 'invite' end,
      case
        when c.email is null then 'No email address on record'
        when c.has_login then 'Already has a login'
        when c.pending then 'Already invited, and that invitation is still open'
      end
    from (
      -- **One row per address, not per person, and not per child.**
      --
      -- Two `distinct on`s, and both are load-bearing. The inner one is per
      -- guardian, because a mother of three is one invitation and not three.
      -- The outer one is per *email*, because in a great many families both
      -- parents give the school one address — and an invitation is to an
      -- address, so a second row for the same one would collide with
      -- `invitation_decisions_one_per_address` and take the whole preview
      -- down with a `23505`.
      --
      -- Where there is no address there is nothing to collide on, so those
      -- rows fall back to the guardian's own id and each keeps its place in
      -- the list -- they are exactly the rows the office needs to see.
      select distinct on (coalesce(lower(c0.email), c0.guardian_id::text)) c0.*
      from (
      select distinct on (g.id)
        g.id as guardian_id,
        btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
        nullif(btrim(coalesce(p.email::text, '')), '') as email,
        exists (select 1 from public.user_profiles up where up.guardian_id = g.id) as has_login,
        exists (select 1 from public.invitations i
                 where i.guardian_id = g.id and i.status = 'pending') as pending
      from public.guardians g
      join public.people p on p.id = g.person_id
      join public.guardian_student gs on gs.guardian_id = g.id
      join public.students s on s.id = gs.student_id and s.status = 'active'
      where p_section_id is null or exists (
        select 1 from public.enrolments e
        where e.student_id = s.id and e.section_id = p_section_id and e.status = 'active')
      order by g.id
      ) c0
      order by coalesce(lower(c0.email), c0.guardian_id::text), c0.full_name, c0.guardian_id
    ) c;

  elsif v_subject = 'student' then
    insert into public.invitation_decisions (
      tenant_id, run_id, student_id, full_name, email, decision, reason)
    select
      v_tenant_id, v_run.id, c.student_id, c.full_name, c.email,
      case when c.email is null or c.has_login or c.pending then 'skip' else 'invite' end,
      case
        when c.email is null then 'No email address on record'
        when c.has_login then 'Already has a login'
        when c.pending then 'Already invited, and that invitation is still open'
      end
    from (
      -- Siblings sharing a parent's address are the same collision one
      -- relationship along.
      select distinct on (coalesce(lower(c0.email), c0.student_id::text)) c0.*
      from (
      select
        s.id as student_id,
        btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
        nullif(btrim(coalesce(p.email::text, '')), '') as email,
        exists (select 1 from public.user_profiles up where up.student_id = s.id) as has_login,
        exists (select 1 from public.invitations i
                 where i.student_id = s.id and i.status = 'pending') as pending
      from public.students s
      join public.people p on p.id = s.person_id
      where s.status = 'active'
        and (p_section_id is null or exists (
          select 1 from public.enrolments e
          where e.student_id = s.id and e.section_id = p_section_id and e.status = 'active'))
      ) c0
      order by coalesce(lower(c0.email), c0.student_id::text), c0.full_name, c0.student_id
    ) c;

  else
    insert into public.invitation_decisions (
      tenant_id, run_id, staff_id, full_name, email, decision, reason)
    select
      v_tenant_id, v_run.id, c.staff_id, c.full_name, c.email,
      case when c.email is null or c.has_login or c.pending then 'skip' else 'invite' end,
      case
        when c.email is null then 'No email address on record'
        when c.has_login then 'Already has a login'
        when c.pending then 'Already invited, and that invitation is still open'
      end
    from (
      select distinct on (coalesce(lower(c0.email), c0.staff_id::text)) c0.*
      from (
      select
        st.id as staff_id,
        btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
        nullif(btrim(coalesce(p.email::text, '')), '') as email,
        exists (select 1 from public.user_profiles up where up.staff_id = st.id) as has_login,
        exists (select 1 from public.invitations i
                 where i.staff_id = st.id and i.status = 'pending') as pending
      from public.staff st
      join public.people p on p.id = st.person_id
      where st.status = 'active'
      ) c0
      order by coalesce(lower(c0.email), c0.staff_id::text), c0.full_name, c0.staff_id
    ) c;
  end if;

  select count(*) into v_count
  from public.invitation_decisions where run_id = v_run.id;

  -- Refuse, do not truncate. A list that quietly held the first thousand of
  -- fourteen hundred would look complete, and the families left off it would
  -- be discovered by their absence months later.
  if v_count > v_max then
    delete from public.invitation_runs where id = v_run.id;
    raise exception 'That is % people, and an invitation list is capped at %. Narrow it to one class at a time.',
      v_count, v_max;
  end if;

  return v_run;
end;
$$;

comment on function public.invitation_preview(uuid, uuid) is
  'Builds an editable invitation list for a role, optionally one class. Every '
  'row arrives as invite or skip with the reason on it; none of the skips is a '
  'refusal, and turning one into an invite records is_override.';

-- ---------------------------------------------------------------------------
-- ...and applying what the rows say
-- ---------------------------------------------------------------------------

create or replace function public.invitation_apply(
  p_run_id uuid,
  p_signup_url text
)
returns table (invited integer, failed integer, emailed integer)
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.invitation_runs;
  v_row record;
  v_inv public.invitations;
  v_invited integer := 0;
  v_failed integer := 0;
  v_emailed integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot invite people to this school.';
  end if;

  select * into v_run from public.invitation_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;

  if v_run.id is null then
    raise exception 'That invitation list does not exist';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'This list was already %', v_run.status;
  end if;

  for v_row in
    select * from public.invitation_decisions d
    where d.run_id = p_run_id and d.decision = 'invite' and d.applied_invitation_id is null
    order by d.full_name, d.id
  loop
    begin
      -- The module's own write function, not an insert: the supersede rule and
      -- the subject-to-column mapping have one implementation.
      v_inv := public.invitation_create(
        v_row.email,
        v_run.role_id,
        coalesce(v_row.guardian_id, v_row.student_id, v_row.staff_id));

      update public.invitation_decisions
      set applied_invitation_id = v_inv.id, error = null
      where id = v_row.id;
      v_invited := v_invited + 1;

      -- A failed announcement is not a failed invitation (rule 10's notice
      -- board, at scale). The row is the mechanism; the email is the courtesy,
      -- and its reason is written down rather than thrown or swallowed.
      begin
        perform public.invitation_announce(v_inv.id, p_signup_url);
        v_emailed := v_emailed + 1;
      exception when others then
        update public.invitation_decisions
        set error = 'Invited, but no email went out: ' || sqlerrm
        where id = v_row.id;
      end;

    exception when others then
      update public.invitation_decisions
      set error = sqlerrm
      where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.invitation_runs
  set status = 'applied', applied_at = now(), applied_by = auth.uid()
  where id = p_run_id;

  return query select v_invited, v_failed, v_emailed;
end;
$$;

comment on function public.invitation_apply(uuid, text) is
  'Applies an invitation list through invitation_create and invitation_announce, '
  'one row at a time, recording why each failure failed. Three counts back, '
  'because invited and emailed are different facts.';

commit;
