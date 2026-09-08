-- 0189 — Absence and invisibility are the same shape.
--
-- Migration 0188 put eight critics on one screen. Probed as an administrator it
-- was perfect, which is exactly the warning CLAUDE.md already records about
-- `dashboard_summary` (migration 0129): *a branch that describes a restricted
-- caller has to be probed as one.*
--
-- Probed as a **teacher**:
--
--     students.left   attention   200 rows
--
-- against the administrator's `ok`. Not a smaller answer — a **bigger** one,
-- and every row of it false.
--
-- `student_exit_problems` has a second branch that reads:
--
--     ... where st.status = 'active'
--       and not exists (select 1 from public.enrolments e
--                       where e.student_id = st.id
--                         and e.session_id = current_session_id(...)
--                         and e.status = 'active')
--
-- — *"active but on no register"*. A teacher's RLS on `enrolments` is
-- row-ownership: they may read the children in the sections they teach and
-- nobody else's. So to a teacher, every child in the school they do not teach
-- has no enrolment, and the page accuses two hundred families of not being
-- enrolled.
--
-- > **A critic built on `not exists` can only be shown to a caller who can see
-- > everybody.** Under row-ownership RLS, absence and invisibility are the same
-- > shape — and the failure is worse than the quiet one CLAUDE.md already
-- > names, because an under-report is a missing sentence and this is a false
-- > accusation.
--
-- The permission is **not** a reliable proxy for that, and the numbers say so:
-- `students.view` is held by teacher, accountant and librarian, and probing all
-- three found the accountant answering `ok` (their RLS is tenant-wide) and the
-- teacher answering 200. One permission, two kinds of visibility. So the
-- catalogue is moved to the permission a school gives to somebody who may
-- *act* on either branch — `students.manage`, admin-only here — which is the
-- honest gate for a question only a whole-school view can answer.
--
-- `staff.left` moves the same way for the same reason, before a school grants
-- `staff.view` to a head of department and gets the same surprise.

update reference.checks
set required_permission = 'students.manage'
where key = 'students.left';

update reference.checks
set required_permission = 'staff.manage'
where key = 'staff.left';

comment on column reference.checks.required_permission is
  'The permission a caller needs to be shown this check. For a critic built on '
  '`not exists`, this must be a permission only a whole-school role holds -- '
  'see migration 0189: under row-ownership RLS a teacher cannot tell an absent '
  'row from an invisible one, and the check accuses everybody they cannot see.';

-- ---------------------------------------------------------------------------
-- …and a capped list has to say it was capped
--
-- The same probe showed the other half: 200 rows is the cap, and nothing on the
-- page said so. A truncated list that looks complete is the mistake rule 13
-- names about imports — *"silently importing the first 500 of 900 children is
-- the worst available outcome"* — arriving here as a screen that reads "200
-- problems" when there may be four hundred.
-- ---------------------------------------------------------------------------

create or replace function public.checks_run()
returns table (
  key text,
  label text,
  description text,
  module text,
  href text,
  status text,
  severity text,
  message text
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_check reference.checks;
  v_found integer;
  v_msg text;
  -- One critic must not be able to fill a page. Bounded per check rather than
  -- overall, so a noisy one cannot crowd out a quiet one with something worse
  -- to say.
  v_cap constant integer := 200;
begin
  if ( select public.current_tenant_id() ) is null then
    raise exception 'No tenant in session';
  end if;

  for v_check in
    select * from reference.checks c where c.is_active order by c.sort, c.key
  loop
    if not ( select public.current_role_allows(v_check.required_permission) ) then
      return query select
        v_check.key, v_check.label, v_check.description, v_check.module, v_check.href,
        'withheld'::text, null::text, null::text;
      continue;
    end if;

    v_found := 0;

    begin
      if v_check.shape = 'severity_message' then
        return query execute format(
          'select $1, $2, $3, $4, $5, ''attention''::text, t.severity::text, t.message::text
             from public.%I() t limit $6',
          v_check.function_name
        ) using v_check.key, v_check.label, v_check.description, v_check.module,
                v_check.href, v_cap;
      else
        return query execute format(
          'select $1, $2, $3, $4, $5, ''attention''::text, ''warning''::text, t.problem::text
             from public.%I() t limit $6',
          v_check.function_name
        ) using v_check.key, v_check.label, v_check.description, v_check.module,
                v_check.href, v_cap;
      end if;

      get diagnostics v_found = row_count;

    exception when others then
      get stacked diagnostics v_msg = message_text;
      return query select
        v_check.key, v_check.label, v_check.description, v_check.module, v_check.href,
        'error'::text, 'error'::text,
        format('This check could not run: %s', v_msg);
      continue;
    end;

    if v_found = 0 then
      return query select
        v_check.key, v_check.label, v_check.description, v_check.module, v_check.href,
        'ok'::text, null::text, null::text;
    elsif v_found >= v_cap then
      -- "200 or more", never a bare 200: the one number this cannot report
      -- honestly is the exact one, and pretending otherwise is what makes a
      -- truncated list look complete.
      return query select
        v_check.key, v_check.label, v_check.description, v_check.module, v_check.href,
        'attention'::text, 'info'::text,
        format('Showing the first %s. There are at least this many, and the rest are on the %s page.',
               v_cap, lower(v_check.label));
    end if;
  end loop;
end;
$$;

revoke all on function public.checks_run() from public, anon;
grant execute on function public.checks_run() to authenticated;
