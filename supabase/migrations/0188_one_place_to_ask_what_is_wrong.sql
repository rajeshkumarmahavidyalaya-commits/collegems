-- 0188 — A critic nobody visits is a critic nobody reads.
--
-- This codebase has been writing critics for a year. `grading_scheme_problems`
-- started it — *"criticise the document in Postgres, not in the browser"* — and
-- there are now eight that take no arguments and answer the same shape of
-- question about the school as it stands:
--
--   academics_session_problems  what a rollover is about to leave behind
--   fees_billing_conflicts      two sources billing the same fee head
--   concession_problems         an award that has expired or lost its student
--   settings_problems           configuration nobody has filled in
--   notify_template_problems    a channel that cannot send what it is asked to
--   schedule_problems           a schedule that runs but reaches nobody
--   student_exit_problems       a child marked gone who is still being billed
--   staff_exit_problems         a leaver who still holds lessons
--
-- Every one of them is surfaced on exactly one screen. So a school finds out
-- that four hundred parents are getting nothing only if somebody happens to
-- open the schedules page, and finds out that a departed teacher still holds
-- nineteen lessons only if somebody opens the cover roster.
--
-- > A critic is only worth what it costs to reach it.
--
-- `reference.checks` is the `reference.reports` pattern applied to them: the
-- catalogue is data, `checks_run()` runs any of them without being edited, and
-- adding a ninth is one row.
--
-- ---------------------------------------------------------------------------
-- Four decisions, and three of them are about honesty
--
-- **1. Only the argument-free ones.** `exams_problems(exam)`,
-- `grading_scheme_problems(rules)` and `certificate_template_problems(template)`
-- criticise *a document you are looking at*, and belong beside it — moving them
-- here would mean choosing which exam to complain about, which is a question
-- only the person holding it can answer. The line is: **does this critic
-- describe the school, or a thing?**
--
-- **2. The schema guards are deliberately not here.** `schema_guard_violations`,
-- `privilege_guard_violations` and `audit_guard_violations` are about the
-- *product*, identical for every tenant, and already the test suite's job.
-- Putting them on a school's screen would ask a head teacher to act on a
-- migration somebody forgot to write.
--
-- **3. A check the caller may not see says so.** Gated per check on the matrix,
-- inside the function (rule 4's `report_run` refinement) — and a withheld check
-- comes back as a row with `status = 'withheld'` rather than being dropped.
-- Rule 11's lesson: *absent-and-withheld* and *absent-and-clean* are different
-- sentences, and only the server knows which applies.
--
-- **4. A check that raises is not a check that passed.** Each critic runs in
-- its own block, and an exception becomes a row with `status = 'error'` and the
-- message on it. This is the failure mode the whole idea invites: one broken
-- critic silently turning a page green. The dashboard's silent zero, avoided on
-- purpose.

create table reference.checks (
  key text primary key,
  label text not null,
  description text not null,
  -- The function is called as `public.<function_name>()` with no arguments.
  -- `%I`-quoted from a table only a migration can write, exactly as
  -- `report_run` does with `reference.reports.function_name`.
  function_name text not null,
  -- Two shapes exist in the codebase and both are declared rather than sniffed:
  -- `severity_message` returns (…, severity, message); `problem` returns a
  -- single text column and everything it says is a warning.
  shape text not null check (shape in ('severity_message', 'problem')),
  module text not null,
  -- Where to go and do something about it. A sentence with nowhere to act on it
  -- is half a critic.
  href text not null,
  required_permission text not null references reference.permissions(code),
  sort integer not null default 100,
  is_active boolean not null default true
);

comment on table reference.checks is
  'The catalogue of school-health critics. Global reference data, outside '
  '`public` so the tenant-column invariant stays meaningful (rule 1); RLS off '
  'for the same reason as `reference.permissions`, and writes are revoked.';

revoke all on table reference.checks from anon, authenticated;
grant select on table reference.checks to anon, authenticated;

insert into reference.checks
  (key, label, description, function_name, shape, module, href, required_permission, sort)
values
  ('academics.session', 'The academic year',
   'What a rollover is about to leave behind, and whether the current year has run out.',
   'academics_session_problems', 'severity_message', 'Academics', '/promotion',
   'academics.manage', 10),

  ('students.left', 'Students who have left',
   'A child marked transferred or alumni who is still enrolled, on a bus or in a bed -- and so still being billed.',
   'student_exit_problems', 'severity_message', 'Students', '/students',
   'students.view', 20),

  ('staff.left', 'Staff who have left',
   'A leaver who still holds lessons, a class or a subject, and the classes that now have nobody.',
   'staff_exit_problems', 'severity_message', 'Staff', '/staff',
   'staff.view', 30),

  ('fees.billing', 'Fee billing conflicts',
   'A fee head billed from two sources at once, which charges a family twice and looks plausible.',
   'fees_billing_conflicts', 'problem', 'Fees', '/fees/setup',
   'fees.view', 40),

  ('fees.concessions', 'Concessions',
   'An award that has expired, or belongs to a child who has left.',
   'concession_problems', 'severity_message', 'Fees', '/fees/concessions',
   'concessions.view', 50),

  ('communication.templates', 'Message templates',
   'A template a channel cannot actually send -- a WhatsApp message with no registered template can never leave the queue.',
   'notify_template_problems', 'problem', 'Communication', '/notifications/templates',
   'communication.view', 60),

  ('schedules.reach', 'Scheduled messages',
   'A schedule that runs green every night while every delivery is skipped.',
   'schedule_problems', 'severity_message', 'Communication', '/schedules',
   'schedules.view', 70),

  ('settings.filled', 'School settings',
   'Configuration nobody has filled in -- the reason a leaving certificate could not print a city.',
   'settings_problems', 'severity_message', 'Settings', '/settings/school',
   'settings.manage', 80);

-- ---------------------------------------------------------------------------
-- The runner
--
-- `SECURITY INVOKER`, so every critic sees exactly what the caller sees. That
-- matters more here than usual: several of these read tables with row-ownership
-- RLS, and a definer runner would hand a teacher the whole school's problems.
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
begin
  if ( select public.current_tenant_id() ) is null then
    raise exception 'No tenant in session';
  end if;

  for v_check in
    select * from reference.checks c where c.is_active order by c.sort, c.key
  loop
    -- Gated per check, inside the function. A screen that decided this would be
    -- a second answer to a question the matrix already answers.
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
             from public.%I() t limit 200',
          v_check.function_name
        ) using v_check.key, v_check.label, v_check.description, v_check.module, v_check.href;
      else
        return query execute format(
          'select $1, $2, $3, $4, $5, ''attention''::text, ''warning''::text, t.problem::text
             from public.%I() t limit 200',
          v_check.function_name
        ) using v_check.key, v_check.label, v_check.description, v_check.module, v_check.href;
      end if;

      get diagnostics v_found = row_count;

    exception when others then
      -- The failure this whole idea invites: one critic that raises, quietly
      -- turning a page green. It is reported as a problem of its own.
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
    end if;
  end loop;
end;
$$;

revoke all on function public.checks_run() from public, anon;
grant execute on function public.checks_run() to authenticated;

comment on function public.checks_run() is
  'Every school-health critic the caller is allowed to see, in one call. A '
  'check with nothing to say returns one `ok` row; one the caller''s role does '
  'not cover returns `withheld`; one that raises returns `error` with the '
  'message -- because a critic that fails is not a critic that passed.';
