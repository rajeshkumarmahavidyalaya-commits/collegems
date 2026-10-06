-- 0343: Events -- the reference's "Events" (Event Title, Event Date, Total
-- Participants, Is Active) -- and who takes part in them.
--
-- 1. `events`. A sports day, a science fair, an annual function: a title, a
--    day, a description and whether it is shown. It records a day, so it is
--    filed under the year its date falls in (rule 2, 0198), never the flag:
--    `event_save` stamps `session_id` from `academics_session_for_date_or_raise`
--    and refuses a date no year covers. Read by every member of the college,
--    written by the administrator -- the notice board's shape. An inactive
--    event stays on the office's list and leaves the calendar and the
--    families' list.
--
-- 2. `event_participants`, one row per student taking part, so Total
--    Participants is a count of rows rather than a number somebody keeps.
--    Two kinds of writer, and they need different rights on the same row:
--
--    * the administrator puts any student on or takes them off, through the
--      table's own policy;
--    * a family puts their own child on, or takes them off, for an active
--      event that has not happened yet.
--
--    A policy for the family would be "insert a row for a child I am the
--    guardian of", which a policy can say -- but "only while the event is
--    active and in the future" is a fact about another table, and the year
--    the row lands in is not theirs to choose. So the family has **no write
--    policy at all**, and `event_join` / `event_leave` are narrow definers
--    that check who is asking, the event and the date, and filter by tenant
--    by hand because no policy runs inside them (the homework_submit shape).
--    A later migration that tidily "adds the missing family insert policy"
--    would let a family put a child on a past or switched-off event.
--
--    Who may read a participation: every member of staff (they run the
--    event), a guardian their own children's, a student their own.
--
-- 3. The school calendar shows active events (kind `event`), beside
--    holidays, exams, fee dates and notices.
--
-- 4. `gate_pass_issue` (0342) refused a role without the front-office policy
--    with the numbering table's RLS error, from inside `visitor_check_in`. The
--    role is checked first now, in a sentence (rule 6: an INSERT whose WITH
--    CHECK fails raises).

begin;

-- ---------------------------------------------------------------------------
-- 1. Events

create table public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  session_id uuid not null references public.academic_sessions (id),
  title text not null check (length(btrim(title)) between 1 and 150),
  event_date date not null,
  description text check (description is null or length(description) <= 4000),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index events_tenant_date_idx on public.events (tenant_id, event_date);
create index events_session_idx on public.events (session_id);

comment on table public.events is
  'A college''s events (sports day, annual function), filed under the year their date falls in. Participants are event_participants (0343).';

create trigger set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger audit_events after insert or update or delete on public.events
  for each row execute function public.audit_row_change();

alter table public.events enable row level security;

create policy "tenant members view events" on public.events
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage events" on public.events
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

-- ---------------------------------------------------------------------------
-- 2. Participants

create table public.event_participants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  event_id uuid not null,
  student_id uuid not null,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, student_id),
  constraint event_participants_event_fkey foreign key (tenant_id, event_id)
    references public.events (tenant_id, id) on delete cascade,
  constraint event_participants_student_fkey foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);
create index event_participants_student_idx on public.event_participants (student_id);

comment on table public.event_participants is
  'Who takes part in an event, one row per student. The administrator writes through the policy; a family through event_join and event_leave only, and has no write policy on purpose (0343).';

create trigger audit_event_participants after insert or update or delete on public.event_participants
  for each row execute function public.audit_row_change();

alter table public.event_participants enable row level security;

create policy "staff view event participants" on public.event_participants
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) not in ('parent', 'student')
  );
create policy "guardians view their children's events" on public.event_participants
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );
create policy "students view their own events" on public.event_participants
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select up.student_id from public.user_profiles up
      where up.id = (select auth.uid()) and up.student_id is not null
    )
  );
-- The administrator's write. There is deliberately no family write policy:
-- a family writes through event_join / event_leave, which check the event.
create policy "admins manage event participants" on public.event_participants
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

-- ---------------------------------------------------------------------------
-- Writing an event

create function public.event_save(
  p_id uuid,
  p_title text,
  p_event_date date,
  p_description text,
  p_is_active boolean
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_id uuid;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if public.current_role_code() is distinct from 'admin' then
    raise exception 'Only an administrator can add or change events.' using errcode = '42501';
  end if;
  if length(v_title) not between 1 and 150 then
    raise exception 'Give the event a title of up to 150 characters.' using errcode = '22023';
  end if;
  if p_event_date is null then
    raise exception 'Give the event a date.' using errcode = '22023';
  end if;

  -- Filed under the year the day falls in, never the flag (rule 2).
  v_session := public.academics_session_for_date_or_raise(p_event_date);

  if p_id is null then
    insert into public.events (tenant_id, session_id, title, event_date, description, is_active, created_by)
    values (v_tenant, v_session, v_title, p_event_date,
            nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    update public.events
    set title = v_title,
        event_date = p_event_date,
        session_id = v_session,
        description = nullif(btrim(coalesce(p_description, '')), ''),
        is_active = coalesce(p_is_active, true)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That event does not exist.' using errcode = '42501';
    end if;
  end if;
  return v_id;
end;
$$;

comment on function public.event_save(uuid, text, date, text, boolean) is
  'Adds (p_id null) or changes an event, filing it under the year its date falls in. INVOKER, administrator only, said before the write (0343).';

-- ---------------------------------------------------------------------------
-- A family's own child, on or off

create function public.event_family_may_act(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid()
      and up.tenant_id = public.current_tenant_id()
      and (
        up.student_id = p_student_id
        or exists (
          select 1 from public.guardian_student gs
          where gs.guardian_id = up.guardian_id and gs.student_id = p_student_id
            and gs.tenant_id = up.tenant_id
        )
      )
  );
$$;

comment on function public.event_family_may_act(uuid) is
  'True when the caller is the student, or a guardian of the student, in the caller''s own college. Used by event_join and event_leave (0343).';

create function public.event_join(p_event_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_event public.events;
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.event_family_may_act(p_student_id) then
    raise exception 'You can put only your own child on an event.' using errcode = '42501';
  end if;
  select * into v_event from public.events e where e.id = p_event_id and e.tenant_id = v_tenant;
  if v_event.id is null or not v_event.is_active then
    raise exception 'That event is not open.' using errcode = '22023';
  end if;
  if v_event.event_date < current_date then
    raise exception 'That event has already happened.' using errcode = '22023';
  end if;

  insert into public.event_participants (tenant_id, event_id, student_id, added_by)
  values (v_tenant, p_event_id, p_student_id, auth.uid())
  on conflict (event_id, student_id) do nothing;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('joined', true, 'already', v_rows = 0);
end;
$$;

comment on function public.event_join(uuid, uuid) is
  'A family puts their own child on an active event that has not happened yet. DEFINER because the family has no write policy on event_participants, on purpose; filters by tenant by hand (0343).';

create function public.event_leave(p_event_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_event public.events;
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.event_family_may_act(p_student_id) then
    raise exception 'You can take only your own child off an event.' using errcode = '42501';
  end if;
  select * into v_event from public.events e where e.id = p_event_id and e.tenant_id = v_tenant;
  if v_event.id is null then
    raise exception 'That event does not exist.' using errcode = '22023';
  end if;
  if v_event.event_date < current_date then
    raise exception 'That event has already happened, so its list stays as it was.' using errcode = '22023';
  end if;

  delete from public.event_participants
  where tenant_id = v_tenant and event_id = p_event_id and student_id = p_student_id;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('left', v_rows > 0);
end;
$$;

comment on function public.event_leave(uuid, uuid) is
  'A family takes their own child off an event that has not happened yet. DEFINER for the same reason as event_join; filters by tenant by hand (0343).';

revoke all on function public.event_family_may_act(uuid) from public, anon;
revoke all on function public.event_join(uuid, uuid) from public, anon;
revoke all on function public.event_leave(uuid, uuid) from public, anon;
grant execute on function public.event_family_may_act(uuid) to authenticated;
grant execute on function public.event_join(uuid, uuid) to authenticated;
grant execute on function public.event_leave(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Events on the school calendar

create or replace function public.school_calendar(p_from date, p_to date)
returns table(starts_on date, ends_on date, kind text, title text, detail text, href text)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    select least(p_from, p_to) as f,
           least(greatest(p_from, p_to), least(p_from, p_to) + 400) as t
  )
  select * from (
    select h.starts_on, h.ends_on, 'holiday'::text, h.name, h.note, null::text
    from public.holidays h, bounds b
    where h.starts_on <= b.t and h.ends_on >= b.f
    union all
    select x.starts_on, coalesce(x.ends_on, x.starts_on), 'exam', x.name,
           case when x.status = 'draft' then 'Draft' else 'Results published' end,
           '/exams/' || x.id
    from public.exams x, bounds b
    where x.starts_on is not null and x.starts_on <= b.t
      and coalesce(x.ends_on, x.starts_on) >= b.f
    union all
    select i.due_date, i.due_date, 'fee_due', i.name || ' due', null, '/fees/instalments'
    from public.fee_instalments i, bounds b
    where i.is_active and i.due_date between b.f and b.t
    union all
    select coalesce(n.starts_on, (n.published_at at time zone 'Asia/Kolkata')::date),
           coalesce(n.expires_on, n.starts_on, (n.published_at at time zone 'Asia/Kolkata')::date),
           'notice', n.title, null, '/notices/' || n.id
    from public.notices n, bounds b
    where n.status = 'published'
      and coalesce(n.starts_on, (n.published_at at time zone 'Asia/Kolkata')::date) between b.f and b.t
    union all
    select ev.event_date, ev.event_date, 'event', ev.title, null, '/events'
    from public.events ev, bounds b
    where ev.is_active and ev.event_date between b.f and b.t
  ) c(starts_on, ends_on, kind, title, detail, href)
  order by c.starts_on, c.kind, c.title
$$;

-- ---------------------------------------------------------------------------
-- 4. A gate pass refused in a sentence

create or replace function public.gate_pass_issue(
  p_student_id uuid,
  p_visitor_name text,
  p_phone text,
  p_relation text,
  p_authorized_by text,
  p_reason text default null
)
returns public.visitors
language plpgsql
set search_path = public, extensions
as $$
declare
  v_row public.visitors;
  v_count integer;
begin
  -- The visitors policy admits the office; said before the INSERT inside
  -- visitor_check_in, which would otherwise raise the numbering table's RLS
  -- error (rule 6).
  if public.current_role_code() is null or public.current_role_code() not in ('admin', 'accountant') then
    raise exception 'Gate passes are issued by the front office.' using errcode = '42501';
  end if;
  if p_student_id is null then
    raise exception 'A gate pass is for a student: choose the student.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'That student is not on this college''s roll.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_relation, ''))) = 0 then
    raise exception 'Say what the visitor is to the student (mother, driver).' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_authorized_by, ''))) = 0 then
    raise exception 'Say who at the school allowed this pass.' using errcode = '22023';
  end if;

  v_row := public.visitor_check_in(
    p_visitor_name,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'To see a student (gate pass)'),
    p_phone,
    null, null, null,
    p_student_id
  );

  update public.visitors
  set relation_to_student = btrim(p_relation),
      authorized_by = btrim(p_authorized_by)
  where id = v_row.id
  returning * into v_row;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'The pass was not written. Gate passes are issued by the front office.'
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

commit;
