-- ---------------------------------------------------------------------------
-- A punch is a machine's observation, and the register is still the register
-- ---------------------------------------------------------------------------
--
-- Measured before building: zero biometric, fingerprint or device tables, and a
-- staff register (`staff_attendance`, 765 rows) written only by a person
-- through `hr_mark_attendance`. A college with a fingerprint reader at the gate
-- had two registers -- the machine's and the office's -- and somebody retyping
-- one into the other.
--
-- Three decisions, and the first is rule 12's:
--
-- 1. **A punch is its own record, and the register is still the register.**
--    `biometric_punches` holds what the reader saw -- a code, an instant, a
--    device -- append-only by revoke (rule 6's stronger shape: the row is the
--    record and nobody should ever edit it). The register row it produces is
--    marked `source = 'reader'`, and **a row a person wrote is never touched**:
--    the office marking somebody *absent* or *on duty* has decided, and a
--    fingerprint at 09:02 does not overrule them. `hr_mark_attendance` now
--    stamps `source = 'register'`, so a person re-marking a reader row takes
--    it over, and the reader never takes it back.
--
-- 2. **A device authenticates with a secret this system generated, and nothing
--    else.** The device has no JWT, so -- like the payment webhook (rule 6) --
--    the write is a `SECURITY DEFINER` function revoked from everybody holding
--    one, called by an Edge Function with the service key, **taking its
--    authority from a row this system wrote**: the device's id and the SHA-256
--    of a 48-hex-character secret shown once at registration. The tenant comes
--    from the device row, never from the request. One sentence for an unknown
--    device, a retired one and a wrong secret, so the endpoint is not a way to
--    ask which device ids exist.
--
-- 3. **It filters by tenant itself, everywhere, because nothing else will.**
--    Inside a definer no policy runs. `academics_session_for_date` has no
--    tenant filter -- it relies on RLS, correctly, for its INVOKER callers --
--    so called from here it would answer with any college's year. The year is
--    resolved inline, by tenant and date.
--
-- And the smaller ones: a code maps to a member of staff through
-- `staff.biometric_code`, unique per college; only **active** staff are matched
-- -- a departed teacher's finger at the gate is stored and named, and marks
-- nobody present (`0191`'s *an ending is not a door that stays shut*); a batch
-- is capped at 500 punches; a punch more than seven days old or more than five
-- minutes in the future is refused as a clock problem rather than filed; and a
-- redelivered batch converges on a unique key.
--
-- A punch carries no `session_id` of its own, deliberately against the letter
-- of rule 2: it is a raw event from a machine that knows nothing about academic
-- years, and the register row it produces carries the year -- resolved from the
-- punch's own local date (`0198`), never from the flag.
--
-- Not built, and named: the ZKTeco/eSSL "iclock" push protocol. Those readers
-- speak their own HTTP dialect; a college using one runs the vendor's bridge
-- software or a small relay that posts this endpoint's JSON. Students on the
-- reader, which is a different register (`attendance_records`, taken per
-- class by a teacher) and a different question.

begin;

-- ------------------------------------------------------------ staff codes --

alter table public.staff
  add column biometric_code text
    check (biometric_code ~ '^[A-Za-z0-9_-]{1,32}$');

comment on column public.staff.biometric_code is
  'The user code this person is enrolled under on the college''s attendance '
  'reader. Unique per college. Null means not enrolled on a reader.';

create unique index staff_biometric_code_key
  on public.staff (tenant_id, biometric_code)
  where biometric_code is not null;

-- ------------------------------------------------------ the register's source --

alter table public.staff_attendance
  add column source text not null default 'register'
    check (source in ('register', 'reader'));

comment on column public.staff_attendance.source is
  'register: a person marked it. reader: the attendance reader did, from the '
  'first and last punch of the day. A reader never overwrites a register row; '
  'a person re-marking a reader row takes it over.';

-- `0198`'s body, unchanged except that every row it writes says a person wrote
-- it -- which is what lets the reader tell whose row it would be overwriting.
create or replace function public.hr_mark_attendance(p_date date, p_entries jsonb)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_entry jsonb;
  v_written integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.academics_session_for_date_or_raise(p_date);

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    if (v_entry ->> 'status') is null then
      delete from public.staff_attendance
      where tenant_id = v_tenant_id
        and staff_id = (v_entry ->> 'staff_id')::uuid
        and attendance_date = p_date
        and leave_request_id is null;
      continue;
    end if;

    insert into public.staff_attendance (
      tenant_id, session_id, staff_id, attendance_date, status, check_in, check_out, note, marked_by, source
    )
    values (
      v_tenant_id, v_session_id,
      (v_entry ->> 'staff_id')::uuid,
      p_date,
      v_entry ->> 'status',
      (v_entry ->> 'check_in')::time,
      (v_entry ->> 'check_out')::time,
      v_entry ->> 'note',
      auth.uid(),
      'register'
    )
    on conflict (tenant_id, staff_id, attendance_date) do update
      set status = excluded.status,
          check_in = excluded.check_in,
          check_out = excluded.check_out,
          note = excluded.note,
          marked_by = excluded.marked_by,
          source = 'register',
          leave_request_id = case
            when excluded.status = 'on_leave' then staff_attendance.leave_request_id
            else null
          end;

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

-- ---------------------------------------------------------------- devices --

create table public.biometric_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- SHA-256 of the secret, hex. The secret itself is shown once and stored
  -- nowhere; see the column grant below.
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create trigger set_updated_at before update on public.biometric_devices
  for each row execute function public.set_updated_at();
create trigger audit_biometric_devices after insert or update or delete on public.biometric_devices
  for each row execute function public.audit_row_change();

alter table public.biometric_devices enable row level security;

create policy "admins manage biometric devices" on public.biometric_devices
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin'))
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'admin'));

-- The hash is not for reading back, even by an administrator: a policy grants
-- whole rows (rule 4, "RLS cannot restrict columns"), so the column is taken
-- out of SELECT by grant. Nobody else has SELECT at all, so a role-wide grant
-- narrows exactly the right thing -- the `certificates` shape.
revoke select on public.biometric_devices from authenticated, anon;
grant select (id, tenant_id, name, is_active, created_by, created_at, updated_at)
  on public.biometric_devices to authenticated;

-- ---------------------------------------------------------------- punches --

create table public.biometric_punches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  device_id uuid not null,
  device_user_code text not null check (device_user_code ~ '^[A-Za-z0-9_-]{1,32}$'),
  punched_at timestamptz not null,
  -- Resolved at ingest; null when the code matched no active member of staff.
  staff_id uuid,
  received_at timestamptz not null default now(),
  constraint biometric_punches_device_fkey
    foreign key (tenant_id, device_id) references public.biometric_devices (tenant_id, id)
    on delete cascade,
  constraint biometric_punches_staff_fkey
    foreign key (tenant_id, staff_id) references public.staff (tenant_id, id)
    on delete set null (staff_id),
  -- A redelivered batch converges: the same finger at the same instant on the
  -- same reader is one punch.
  constraint biometric_punches_once unique (device_id, device_user_code, punched_at)
);

create index biometric_punches_when_idx on public.biometric_punches (tenant_id, punched_at);
create index biometric_punches_staff_idx on public.biometric_punches (tenant_id, staff_id, punched_at);

create trigger audit_biometric_punches after insert or update or delete on public.biometric_punches
  for each row execute function public.audit_row_change();

alter table public.biometric_punches enable row level security;

create policy "admins view biometric punches" on public.biometric_punches
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin'));

-- A member of staff may see their own punches: it is the evidence behind a
-- register row about them, and "the reader says I was here at 09:02" is a
-- question they are entitled to ask.
create policy "staff view own biometric punches" on public.biometric_punches
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and staff_id is not null
         and staff_id = ( select up.staff_id from public.user_profiles up
                          where up.id = ( select auth.uid() ) ));

-- The record of what a machine saw: append-only by revoke, written only by
-- `biometric_ingest` below.
revoke insert, update, delete on public.biometric_punches from authenticated, anon;

-- ------------------------------------------------------------ the ingest --

create or replace function public.biometric_ingest(
  p_device_id uuid,
  p_secret text,
  p_punches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.biometric_devices;
  v_tz text;
  v_punch jsonb;
  v_code text;
  v_at timestamptz;
  v_staff uuid;
  v_id uuid;
  v_new uuid[] := '{}';
  v_duplicates integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_unmatched text[] := '{}';
  v_register integer := 0;
  v_no_year integer := 0;
begin
  -- One sentence for every reason a device is not recognised.
  select * into v_device from public.biometric_devices d where d.id = p_device_id;
  if v_device.id is null
     or not v_device.is_active
     or v_device.secret_hash is distinct from
        encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then
    raise exception 'This device is not registered, has been retired, or sent the wrong secret.'
      using errcode = '28000';
  end if;

  if jsonb_typeof(p_punches) is distinct from 'array' then
    raise exception 'Send the punches as a JSON array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_punches) > 500 then
    raise exception 'At most 500 punches in one batch; this one had %. Send the rest in another.',
      jsonb_array_length(p_punches) using errcode = '54000';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_device.tenant_id;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');

  for v_punch in select * from jsonb_array_elements(p_punches) loop
    v_code := btrim(coalesce(v_punch ->> 'code', ''));
    begin
      v_at := (v_punch ->> 'at')::timestamptz;
    exception when others then
      v_at := null;
    end;

    if v_code !~ '^[A-Za-z0-9_-]{1,32}$' or v_at is null then
      v_rejected := v_rejected || jsonb_build_object('punch', v_punch, 'reason', 'not a code and a time');
      continue;
    end if;
    -- A reader whose clock has drifted files a morning under the wrong day,
    -- silently. Refused and named instead, so somebody sets the clock.
    if v_at < now() - interval '7 days' or v_at > now() + interval '5 minutes' then
      v_rejected := v_rejected || jsonb_build_object('punch', v_punch, 'reason', 'outside the last seven days -- check the reader''s clock');
      continue;
    end if;

    -- Active staff only: a departed teacher's finger is stored and named, and
    -- marks nobody present.
    select s.id into v_staff
    from public.staff s
    where s.tenant_id = v_device.tenant_id
      and s.biometric_code = v_code
      and s.status = 'active';

    insert into public.biometric_punches (tenant_id, device_id, device_user_code, punched_at, staff_id)
    values (v_device.tenant_id, v_device.id, v_code, v_at, v_staff)
    on conflict (device_id, device_user_code, punched_at) do nothing
    returning id into v_id;

    if v_id is null then
      v_duplicates := v_duplicates + 1;
    else
      v_new := v_new || v_id;
      if v_staff is null and not (v_code = any (v_unmatched)) then
        v_unmatched := v_unmatched || v_code;
      end if;
    end if;
    v_id := null;
    v_staff := null;
  end loop;

  -- The register, from the first and last punch of each person's day where the
  -- college is. Filtered by tenant by hand throughout: no policy runs here.
  with touched as (
    select distinct bp.staff_id, (bp.punched_at at time zone v_tz)::date as on_date
    from public.biometric_punches bp
    where bp.id = any (v_new) and bp.staff_id is not null
  ),
  spans as (
    select
      t.staff_id,
      t.on_date,
      min((bp.punched_at at time zone v_tz)::time) as first_in,
      max((bp.punched_at at time zone v_tz)::time) as last_out,
      (select a.id from public.academic_sessions a
        where a.tenant_id = v_device.tenant_id
          and t.on_date between a.start_date and a.end_date) as session_id
    from touched t
    join public.biometric_punches bp
      on bp.tenant_id = v_device.tenant_id
     and bp.staff_id = t.staff_id
     and bp.punched_at >= (t.on_date::timestamp at time zone v_tz)
     and bp.punched_at < ((t.on_date + 1)::timestamp at time zone v_tz)
    group by t.staff_id, t.on_date
  )
  insert into public.staff_attendance as sa (
    tenant_id, session_id, staff_id, attendance_date, status,
    check_in, check_out, note, marked_by, source
  )
  select
    v_device.tenant_id, s.session_id, s.staff_id, s.on_date, 'present',
    s.first_in,
    case when s.last_out > s.first_in then s.last_out end,
    'From the attendance reader',
    null,
    'reader'
  from spans s
  where s.session_id is not null
  on conflict (tenant_id, staff_id, attendance_date) do update
    set check_in = excluded.check_in,
        check_out = excluded.check_out
    -- A person's mark is a decision; the reader only ever updates its own.
    where sa.source = 'reader';
  get diagnostics v_register = row_count;

  select count(*) into v_no_year
  from (
    select distinct (bp.punched_at at time zone v_tz)::date as on_date
    from public.biometric_punches bp
    where bp.id = any (v_new) and bp.staff_id is not null
  ) d
  where not exists (
    select 1 from public.academic_sessions a
    where a.tenant_id = v_device.tenant_id and d.on_date between a.start_date and a.end_date
  );

  -- No `last_seen_at` is written: a reader posting every minute would add an
  -- audit row a minute for a fact the punches already carry. When a reader was
  -- last heard from is `max(received_at)` of what it sent.

  return jsonb_build_object(
    'accepted', coalesce(array_length(v_new, 1), 0),
    'duplicates', v_duplicates,
    'rejected', v_rejected,
    'unmatched_codes', to_jsonb(v_unmatched),
    'register_rows', v_register,
    'days_outside_any_year', v_no_year
  );
end;
$$;

-- Nothing holding a JWT may call it -- the fees_settle_gateway_payment shape.
-- The Edge Function calls it with the service key.
revoke all on function public.biometric_ingest(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.biometric_ingest(uuid, text, jsonb) to service_role;

comment on function public.biometric_ingest(uuid, text, jsonb) is
  'Punches from an attendance reader. SECURITY DEFINER, callable only by the '
  'service role (the biometric-punch Edge Function); authenticates the device '
  'by the SHA-256 of a secret this system generated and takes the tenant from '
  'the device row. Stores every punch, writes the staff register from the '
  'first and last punch of each day for active staff, and never overwrites a '
  'row a person marked. Migration 0273.';

-- ------------------------------------------------- what the office calls --

create or replace function public.biometric_device_register(p_name text)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_secret text;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can register an attendance reader.';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Give the reader a name of up to 80 characters, such as "Main gate".';
  end if;

  -- 24 random bytes. Shown once, here, and stored only as a hash.
  v_secret := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.biometric_devices (tenant_id, name, secret_hash)
  values (v_tenant_id, btrim(p_name), encode(extensions.digest(v_secret, 'sha256'), 'hex'))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'secret', v_secret);
end;
$$;

revoke all on function public.biometric_device_register(text) from public, anon;
grant execute on function public.biometric_device_register(text) to authenticated;

create or replace function public.biometric_device_retire(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  update public.biometric_devices set is_active = false where id = p_id and is_active;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That reader is already retired, or is not one you can retire.';
  end if;
end;
$$;

revoke all on function public.biometric_device_retire(uuid) from public, anon;
grant execute on function public.biometric_device_retire(uuid) to authenticated;

create or replace function public.staff_set_biometric_code(p_staff_id uuid, p_code text)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_count integer;
begin
  if v_code is not null and v_code !~ '^[A-Za-z0-9_-]{1,32}$' then
    raise exception 'A reader code is letters, digits, - and _ only, up to 32 characters.';
  end if;
  if v_code is not null and exists (
    select 1 from public.staff s
    where s.tenant_id = public.current_tenant_id() and s.biometric_code = v_code and s.id <> p_staff_id
  ) then
    raise exception 'Code % is already given to somebody else on this reader.', v_code;
  end if;

  update public.staff set biometric_code = v_code where id = p_staff_id;
  -- The admin policy decides who may; an UPDATE it does not match is silent
  -- (rule 6), so the count is the refusal.
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That member of staff is not one you can change.';
  end if;
end;
$$;

revoke all on function public.staff_set_biometric_code(uuid, text) from public, anon;
grant execute on function public.staff_set_biometric_code(uuid, text) to authenticated;

-- What the office needs to act on: codes the reader sent that match nobody,
-- and readers that have gone quiet. INVOKER over the admin-only policies above.
create or replace function public.biometric_problems()
returns table (kind text, subject text, detail text)
language sql
stable
set search_path = public, extensions
as $$
  select 'unmatched'::text, bp.device_user_code,
         count(*)::text || case when count(*) = 1 then ' punch' else ' punches' end
         || ' in the last seven days, the last at '
         -- The college's wall clock, not the server's (rule 11).
         || to_char(max(bp.punched_at) at time zone t.timezone, 'DD Mon HH24:MI')
  from public.biometric_punches bp
  join public.tenants t on t.id = bp.tenant_id
  where bp.staff_id is null and bp.punched_at > now() - interval '7 days'
  group by bp.device_user_code, t.timezone
  union all
  select 'silent', d.name,
         case when heard.at is null then 'has never sent a punch'
              else 'has sent nothing since ' || to_char(heard.at, 'DD Mon YYYY') end
  from public.biometric_devices d
  left join lateral (
    select max(bp.received_at) as at from public.biometric_punches bp where bp.device_id = d.id
  ) heard on true
  where d.is_active and (heard.at is null or heard.at < now() - interval '2 days')
  order by 1, 2
$$;

revoke all on function public.biometric_problems() from public, anon;
grant execute on function public.biometric_problems() to authenticated;

commit;
