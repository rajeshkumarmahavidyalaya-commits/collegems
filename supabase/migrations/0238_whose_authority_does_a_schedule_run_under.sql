-- 0238 -- Whose authority does a schedule run under?
--
-- The last named piece of `jobs` work, and it was never blocked on code. Rule 7
-- says so in as many words:
--
-- > A scheduled job has no user, so anything it does must be expressible
-- > without one. Sending a message about a row is. Running a catalog report is
-- > not — `report_run` gates on `role_permissions` for `current_role_code()`,
-- > and a scheduler has no role.
--
-- Three ways out, and two of them are the ones this file already refuses.
--
--   * **Invent a service identity.** A role that may run any report in any
--     college is rule 1's hole with a cron attached.
--   * **A definer twin of `report_run`.** Rule 6 draws that line precisely: the
--     split is safe where the invoker version's protection is a tenant or role
--     check, and unsafe where it is **row-ownership**. Half the catalogue is
--     row-scoped — a teacher's roster is their sections — so a definer twin
--     would hand the scheduler the whole school and call it a digest.
--   * **Run as the person who asked.** Which is what this does.
--
-- ## The consent is in the creation
--
-- `0209` refuses support impersonation, and the reasons it gives are the test
-- this has to pass: *consent, a time limit, and an audit trail the college can
-- read.* A scheduled report has all three by construction, and that is the
-- whole argument for why it is a different thing:
--
--   * **consent** — the person scheduled it themselves, for themselves;
--   * **a time limit** — one statement inside one transaction, `SET LOCAL`;
--   * **a trail** — `schedule_runs`, which the college already reads.
--
-- And the mechanism takes **no user parameter from any caller.** It reads
-- `schedules.created_by` off the row. A function that accepted a uuid and
-- assumed that identity is exactly the hole; one that reads it from a row the
-- college wrote is a different function with the same SQL in the middle.
--
-- ## The authority is re-checked, not remembered
--
-- Stamping the creator is not enough — an administrator who leaves in March
-- must not still be running the fee digest in June. So every occurrence
-- re-asks, as the definer, before it assumes anybody:
--
--   1. does that login still exist, and still belong to this college?
--   2. does their role still hold the report's `required_permission`?
--
-- A no is recorded on the run **with the reason**, never skipped: *"why did
-- nothing arrive on the 3rd"* must have an answer, which is rule 7's own rule
-- about missed work.
--
-- ## …and it sends the number, not the rows
--
-- The obvious digest is the report attached to an email. It is the wrong one:
--
-- > **An inbox is not a place with row-level security.** Once the rows are in
-- > one they are past every policy this system has — forwarded, printed, read
-- > by whoever is standing at the screen. The gate can only hold where
-- > `report_run` runs, which is where the person is.
--
-- So the digest carries the report's name, the count and where to look. That is
-- the thing a person acts on anyway — *"96 families owe money"* is the nudge;
-- the list is one click away and is answered by the policy when they ask for
-- it. It also happens to remove the PDF, the CSV and the font bundle from a
-- feature that never needed them.
--
-- ## Who receives it
--
-- **The creator, and nobody else.** That is the conservative reading, and it
-- makes the authority question and the audience question the *same* question:
-- you may only schedule a report to yourself, so the two can never disagree.
-- Sending a colleague a number computed under your permissions is a second
-- decision and needs its own argument; this migration does not make it.

begin;

-- ---------------------------------------------------------------------------
-- The kind
-- ---------------------------------------------------------------------------

alter table public.schedules drop constraint if exists schedules_kind_check;
alter table public.schedules add constraint schedules_kind_check
  check (kind in ('attendance.absentees', 'fees.due_reminder', 'library.overdue', 'report.digest'));

-- ---------------------------------------------------------------------------
-- ...and the column that becomes an authority
-- ---------------------------------------------------------------------------

-- `created_by` has existed since the module shipped and has been decoration:
-- written by the app when it remembered, read by nothing. Giving it a job means
-- giving it a writer that a plain insert cannot route around (`0205`'s lesson)
-- and refusing to let it be edited afterwards -- an authority you can rewrite
-- is an authority you can borrow.
create or replace function public.schedule_stamp_creator()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception
      'A schedule''s owner cannot be changed. It decides whose permissions the '
      'run uses, so moving it would be a way of borrowing somebody else''s. '
      'Delete this schedule and create it again as the person who should own it.';
  end if;

  return new;
end;
$$;

drop trigger if exists schedules_stamp_creator on public.schedules;
create trigger schedules_stamp_creator
  before insert or update on public.schedules
  for each row execute function public.schedule_stamp_creator();

-- Pending-style: only the kind that needs an owner is required to have one, so
-- the three existing kinds and every row already in the table are untouched.
alter table public.schedules drop constraint if exists schedules_digest_has_an_owner;
alter table public.schedules add constraint schedules_digest_has_an_owner
  check (kind <> 'report.digest' or created_by is not null);

comment on column public.schedules.created_by is
  'Who owns this schedule. For report.digest it is load-bearing: the run uses '
  'this person''s permissions and sends only to them, re-checked at every '
  'occurrence. Stamped by a trigger and immutable.';

-- ---------------------------------------------------------------------------
-- The event
-- ---------------------------------------------------------------------------

insert into reference.notification_types (key, name, description, default_channels, stale_after)
values (
  'report.digest',
  'Scheduled report',
  'The answer to a report somebody scheduled for themselves: its name, how many rows it has today, and where to read them.',
  array['in_app', 'email'],
  '3 days'::interval
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  default_channels = excluded.default_channels,
  stale_after = excluded.stale_after;

-- ---------------------------------------------------------------------------
-- Running one report as the person who asked for it
-- ---------------------------------------------------------------------------

create or replace function public.schedule_report_digest(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
-- The `set search_path` clause is doing more than naming a schema here.
-- PostgreSQL saves the whole GUC stack on entry to a function that has a SET
-- clause and restores it on exit, **including on error** -- so the `set local
-- role` and the JWT claims below cannot escape into the rest of the tick. The
-- explicit restore afterwards is belt and braces; this is the braces.
set search_path = 'public', 'extensions'
as $$
declare
  v_s public.schedules;
  v_key text;
  v_report record;
  v_up record;
  v_role_code text;
  v_rows bigint := 0;
  v_claims text;
begin
  select * into v_s from public.schedules where id = p_schedule_id;
  if v_s.id is null then
    raise exception 'No such schedule';
  end if;
  if v_s.kind <> 'report.digest' then
    raise exception 'That schedule is not a report digest';
  end if;

  v_key := nullif(btrim(coalesce(v_s.params ->> 'report_key', '')), '');
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason',
      'This schedule does not say which report to run.');
  end if;

  select r.key, r.name, r.required_permission into v_report
  from reference.reports r where r.key = v_key;
  if v_report.key is null then
    return jsonb_build_object('ok', false, 'reason',
      format('There is no report called %s any more.', v_key));
  end if;

  -- 1. Does the person still exist, and still belong to this college?
  select up.id, up.role_id, up.tenant_id into v_up
  from public.user_profiles up
  where up.id = v_s.created_by and up.tenant_id = v_s.tenant_id;

  if v_up.id is null then
    return jsonb_build_object('ok', false, 'reason',
      'The person who scheduled this no longer has a login at this college, so '
      'there is nobody whose permissions the run could use.');
  end if;

  select r.code into v_role_code from public.roles r where r.id = v_up.role_id;

  -- 2. Does their role still hold the permission the report is gated on?
  --    Asked as the definer, because the answer is about them and not about us.
  if not exists (
    select 1 from public.role_permissions rp
    where rp.tenant_id = v_s.tenant_id
      and rp.role_id = v_up.role_id
      and rp.permission_code = v_report.required_permission
      and rp.allowed
  ) then
    return jsonb_build_object('ok', false, 'reason',
      format('%s may no longer run %s, so nothing was sent. Their role lost %s.',
             coalesce(v_role_code, 'That role'), v_report.name,
             v_report.required_permission));
  end if;

  -- 3. Become them, for exactly one statement.
  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_up.id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', v_s.tenant_id,
        'role', v_role_code)
    )::text, true);

    -- Both halves are needed. The claims alone are not enough: RLS does not
    -- apply to `postgres` at all, so without the role change the count would be
    -- every college's rows and would look entirely plausible -- `0205`'s probe
    -- reporting 303 students for a school with none, arriving in production.
    set local role authenticated;

    select max(rr.total_count) into v_rows
    from public.report_run(v_report.key, coalesce(v_s.params -> 'report_params', '{}'::jsonb), 1, 0) rr;

    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
    raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, 0),
    'report_name', v_report.name,
    'recipient', v_up.id);
end;
$$;

-- Nobody holding a JWT. This is the one function in the schema that assumes
-- another person's identity, and the only thing that makes it safe is that it
-- takes no identity from its caller -- so the caller must be the tick.
revoke all on function public.schedule_report_digest(uuid) from public, anon, authenticated;

comment on function public.schedule_report_digest(uuid) is
  'Runs one scheduled report as the person who scheduled it, re-checking that '
  'they still have a login here and still hold the report''s permission. Takes '
  'no user parameter: the identity comes from schedules.created_by, which is '
  'stamped by a trigger and immutable. Revoked from everybody holding a JWT.';

commit;
