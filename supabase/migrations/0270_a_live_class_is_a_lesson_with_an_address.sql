-- ---------------------------------------------------------------------------
-- A live class is a lesson with an address
-- ---------------------------------------------------------------------------
--
-- Measured before building: zero occurrences of a meeting link anywhere in the
-- schema or `src/`. A college teaching online sent the link over WhatsApp,
-- which is how a link to a class ends up forwarded to people who are not in it
-- and lost by the people who are.
--
-- What this builds is deliberately small: **a lesson, on a date, for one class,
-- with an address to join it at.** The meeting itself happens on a provider's
-- servers and is not this product's to host. Four things decide the shape:
--
-- 1. **It is keyed onto `section_subjects`**, the table that says *this class
--    studies this subject this year, taught by this person* -- rule 4's
--    composite-key device, identity use. A live class for a subject the section
--    does not study, or in another year's section, is unrepresentable rather
--    than checked. And the policies are homework's, row for row, because the
--    question is identical: the subject teacher writes, the class teacher and
--    the family read, the administrator does either.
--
-- 2. **The address is an allowlist, not a text box.** A link the college's own
--    product puts in front of 300 families is a link the college vouches for,
--    and a free-text field is a phishing vector with the college's name on it
--    -- one compromised teacher login and every family is one tap from a
--    lookalike page. So `join_url` must match its provider's shape in a CHECK:
--    Google Meet's `abc-defg-hij`, a Zoom meeting number, a Teams join link, or
--    a Jitsi room **this function generates** -- 24 random hex characters, so a
--    room nobody was sent is a room nobody can guess.
--
-- 3. **Two lessons for one class cannot overlap**, by an exclusion constraint
--    over the time range, partial on `scheduled` so a cancelled class stops
--    blocking its slot (the leave-request precedent). `ends_at` is a stored
--    column rather than generated from a duration, because `timestamptz +
--    interval` is only STABLE and neither a generated column nor an index
--    expression will take it.
--
-- 4. **Times are instants, entered as the college's wall clock.** The write
--    function takes a date and a time and resolves them with
--    `tenants.timezone` -- rule 7's *a time of day is a wall clock, not an
--    instant*, and rule 11's *Vercel runs in UTC; the school does not*. The read
--    function hands back the timezone beside the instants so a screen formats
--    them where the college is, not where the server is.
--
-- The year is the section's (rule 2): the class belongs to the year its section
-- belongs to, and a date outside that year is refused in a sentence rather than
-- filed under it -- `0198`'s refusal, for a lesson.
--
-- Not built, and named: attendance at a live class (the provider knows who
-- joined; this product does not, and a register nobody took is not a register),
-- recordings, and a notification when one is scheduled -- the class list is
-- where a family looks, and an announcement per lesson is the notice board's
-- job if a college wants it.

begin;

-- ------------------------------------------------------------ permissions --

insert into reference.permissions (code, module, ability, description) values
  ('liveclasses.view', 'liveclasses', 'view', 'See live classes and join them'),
  ('liveclasses.manage', 'liveclasses', 'manage', 'Schedule and cancel live classes');

-- Existing colleges, by reading the matrix (0213): whoever may see homework may
-- see a live class, whoever sets homework may schedule one -- the same act, a
-- teacher doing something for their own class.
insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, 'liveclasses.view', true
from public.role_permissions rp
where rp.permission_code = 'homework.view' and rp.allowed
on conflict do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, 'liveclasses.manage', true
from public.role_permissions rp
where rp.permission_code = 'homework.manage' and rp.allowed
on conflict do nothing;

-- ...and colleges founded tomorrow (0269), which reading the matrix cannot reach.
insert into reference.role_permission_defaults (role_code, permission_code) values
  ('teacher', 'liveclasses.view'),
  ('teacher', 'liveclasses.manage'),
  ('student', 'liveclasses.view'),
  ('parent', 'liveclasses.view');

-- ------------------------------------------------------------------ table --

create table public.live_classes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  section_id uuid not null,
  subject_id uuid not null,
  teacher_staff_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  provider text not null check (provider in ('jitsi', 'meet', 'zoom', 'teams')),
  join_url text not null check (length(join_url) <= 1200),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, id),

  -- Identity use of the composite key: this class studies this subject this
  -- year. Cascades with the course, like homework: a lesson scheduled for a
  -- subject the section no longer studies is not a lesson.
  constraint live_classes_course_fkey
    foreign key (tenant_id, session_id, section_id, subject_id)
    references public.section_subjects (tenant_id, session_id, section_id, subject_id)
    on delete cascade,
  constraint live_classes_teacher_fkey
    foreign key (tenant_id, teacher_staff_id)
    references public.staff (tenant_id, id) on delete set null (teacher_staff_id),

  constraint live_classes_length_chk
    check (ends_at > starts_at and ends_at <= starts_at + interval '5 hours'),

  -- The allowlist. Each provider's own shape and nothing else, so no free text
  -- the college did not choose can sit behind a "Join" button.
  constraint live_classes_url_chk check (
    case provider
      when 'jitsi' then join_url ~ '^https://meet\.jit\.si/SchoolOS[0-9a-f]{24}$'
      when 'meet'  then join_url ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'
      when 'zoom'  then join_url ~ '^https://([a-z0-9-]+\.)?zoom\.us/j/[0-9]{9,11}(\?pwd=[A-Za-z0-9._-]{1,64})?$'
      when 'teams' then join_url ~ '^https://teams\.(microsoft|live)\.com/(l/meetup-join|meet)/[A-Za-z0-9%._~/?=&:@+-]+$'
      else false
    end
  ),

  constraint live_classes_cancel_chk
    check ((status = 'cancelled') = (cancel_reason is not null and btrim(cancel_reason) <> ''))
);

-- One class cannot be in two lessons at once. Partial: a cancelled lesson gives
-- its slot back.
alter table public.live_classes
  add constraint live_classes_no_overlap
  exclude using gist (
    tenant_id with =,
    section_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'scheduled');

create index live_classes_when_idx on public.live_classes (tenant_id, starts_at);

create trigger set_updated_at before update on public.live_classes
  for each row execute function public.set_updated_at();
create trigger audit_live_classes after insert or update or delete on public.live_classes
  for each row execute function public.audit_row_change();

alter table public.live_classes enable row level security;

-- ------------------------------------------------------------- policies --
-- Homework's, row for row (0048 and after): the question is the same one.

create policy "admins manage live classes" on public.live_classes
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin'))
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'admin'));

create policy "subject teachers manage their live classes" on public.live_classes
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.section_subjects ss
           join public.user_profiles up on up.staff_id = ss.teacher_staff_id
           where ss.tenant_id = live_classes.tenant_id
             and ss.session_id = live_classes.session_id
             and ss.section_id = live_classes.section_id
             and ss.subject_id = live_classes.subject_id
             and up.id = ( select auth.uid() )))
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'teacher')
              and exists (
                select 1 from public.section_subjects ss
                join public.user_profiles up on up.staff_id = ss.teacher_staff_id
                where ss.tenant_id = live_classes.tenant_id
                  and ss.session_id = live_classes.session_id
                  and ss.section_id = live_classes.section_id
                  and ss.subject_id = live_classes.subject_id
                  and up.id = ( select auth.uid() )));

create policy "class teachers view their section live classes" on public.live_classes
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.sections s
           join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
           where s.id = live_classes.section_id and up.id = ( select auth.uid() )));

create policy "students view own live classes" on public.live_classes
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'student')
         and section_id in (
           select e.section_id from public.enrolments e
           where e.student_id = ( select up.student_id from public.user_profiles up
                                  where up.id = ( select auth.uid() ))
             and e.status = 'active'));

create policy "parents view own children live classes" on public.live_classes
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'parent')
         and section_id in (
           select e.section_id from public.enrolments e
           join public.guardian_student gs on gs.student_id = e.student_id
           join public.user_profiles up on up.guardian_id = gs.guardian_id
           where up.id = ( select auth.uid() ) and e.status = 'active'));

-- ------------------------------------------------------------ the write --

create or replace function public.live_class_schedule(p_class jsonb)
returns public.live_classes
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_tz text;
  v_section public.sections;
  v_session public.academic_sessions;
  v_teacher uuid;
  v_subject uuid;
  v_title text := btrim(coalesce(p_class ->> 'title', ''));
  v_on date;
  v_at time;
  v_minutes integer;
  v_provider text := coalesce(nullif(btrim(p_class ->> 'provider'), ''), 'jitsi');
  v_url text := nullif(btrim(coalesce(p_class ->> 'join_url', '')), '');
  v_starts timestamptz;
  v_row public.live_classes;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if not ( select public.role_has_permission('liveclasses.manage') ) then
    raise exception 'Your role may not schedule live classes. That needs the "liveclasses.manage" permission.';
  end if;

  select * into v_section from public.sections s where s.id = (p_class ->> 'section_id')::uuid;
  if v_section.id is null then
    raise exception 'Choose a class.';
  end if;
  v_subject := (p_class ->> 'subject_id')::uuid;

  select ss.teacher_staff_id into v_teacher
  from public.section_subjects ss
  where ss.tenant_id = v_tenant_id and ss.session_id = v_section.session_id
    and ss.section_id = v_section.id and ss.subject_id = v_subject;
  if not found then
    raise exception 'That class does not study that subject this year.';
  end if;

  -- An INSERT whose WITH CHECK fails raises a policy error nobody should read
  -- (0257), so the policy's question is asked first, for the message. The
  -- policy still decides.
  if ( select public.current_role_code() ) <> 'admin' and not exists (
    select 1 from public.user_profiles up
    where up.id = ( select auth.uid() ) and up.staff_id is not null and up.staff_id = v_teacher
  ) then
    raise exception 'Only the teacher of this subject for this class, or an administrator, can schedule its live classes.';
  end if;

  if v_title = '' or length(v_title) > 120 then
    raise exception 'Give the lesson a title of up to 120 characters.';
  end if;

  begin
    v_on := (p_class ->> 'date')::date;
    v_at := (p_class ->> 'time')::time;
    v_minutes := (p_class ->> 'minutes')::integer;
  exception when others then
    raise exception 'Give a date, a start time and a length in minutes.';
  end;
  if v_on is null or v_at is null or v_minutes is null then
    raise exception 'Give a date, a start time and a length in minutes.';
  end if;
  if v_minutes < 5 or v_minutes > 300 then
    raise exception 'A live class can be between 5 minutes and 5 hours long.';
  end if;

  -- Rule 2: the lesson belongs to its section's year, and a date outside that
  -- year is a lesson filed under a year it did not happen in.
  select * into v_session from public.academic_sessions a where a.id = v_section.session_id;
  if v_on < v_session.start_date or v_on > v_session.end_date then
    raise exception '% falls outside %, the year this class belongs to. Choose a date inside it, or the class in the right year.',
      to_char(v_on, 'FMDD Mon YYYY'), v_session.name;
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_tenant_id;
  v_starts := (v_on + v_at) at time zone coalesce(v_tz, 'Asia/Kolkata');
  if v_starts + make_interval(mins => v_minutes) < now() then
    raise exception 'That lesson would already be over. Choose a time that has not passed.';
  end if;

  if v_provider = 'jitsi' then
    -- Generated here, never typed: 24 random hex characters, so a room nobody
    -- was sent is a room nobody can guess.
    v_url := 'https://meet.jit.si/SchoolOS' || encode(extensions.gen_random_bytes(12), 'hex');
  elsif v_url is null then
    raise exception 'Paste the meeting link from %.', case v_provider
      when 'meet' then 'Google Meet' when 'zoom' then 'Zoom' when 'teams' then 'Microsoft Teams'
      else v_provider end;
  end if;

  insert into public.live_classes (
    tenant_id, session_id, section_id, subject_id, teacher_staff_id,
    title, starts_at, ends_at, provider, join_url
  )
  values (
    v_tenant_id, v_section.session_id, v_section.id, v_subject, v_teacher,
    v_title, v_starts, v_starts + make_interval(mins => v_minutes), v_provider, v_url
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.live_class_schedule(jsonb) is
  'Schedule one live lesson for a class and subject. INVOKER: the policies '
  'decide who may write, and are asked first only for the message. Resolves '
  'the date and time on the college''s wall clock, files it under the '
  'section''s year, and generates a Jitsi room when no provider link is '
  'given. The URL CHECK and the overlap constraint are the enforcement.';

revoke all on function public.live_class_schedule(jsonb) from public, anon;
grant execute on function public.live_class_schedule(jsonb) to authenticated;

create or replace function public.live_class_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why the lesson is cancelled -- the families will see it.';
  end if;

  update public.live_classes
  set status = 'cancelled', cancel_reason = btrim(p_reason)
  where id = p_id and status = 'scheduled';

  -- An UPDATE no policy matches writes nothing and raises nothing (rule 6), so
  -- the count is the refusal.
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That lesson is not one you can cancel -- it is already cancelled, or it is not yours.';
  end if;
end;
$$;

revoke all on function public.live_class_cancel(uuid, text) from public, anon;
grant execute on function public.live_class_cancel(uuid, text) to authenticated;

-- -------------------------------------------------------------- the read --

create or replace function public.live_classes_between(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  provider text,
  join_url text,
  status text,
  cancel_reason text,
  section_id uuid,
  section_label text,
  subject_name text,
  teacher_name text,
  timezone text,
  can_manage boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    lc.id, lc.title, lc.starts_at, lc.ends_at, lc.provider, lc.join_url,
    lc.status, lc.cancel_reason, lc.section_id,
    (cl.name || ' ' || s.name),
    sub.name,
    -- The teacher's name through `staff_directory`, the one read of staff names
    -- every role may make (0193): a family reads their child's lesson and the
    -- name of whoever is teaching it, and none of the employment record.
    sd.full_name,
    t.timezone,
    -- Whether this caller may cancel it, decided the way the policy decides:
    -- the administrator, or the subject's own teacher.
    (( select public.current_role_code() ) = 'admin'
      or exists (select 1 from public.user_profiles up
                 where up.id = ( select auth.uid() ) and up.staff_id = lc.teacher_staff_id))
  from public.live_classes lc
  join public.sections s on s.id = lc.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = lc.subject_id
  join public.tenants t on t.id = lc.tenant_id
  left join public.staff_directory() sd on sd.staff_id = lc.teacher_staff_id
  -- A window, not a year: "what is on this week" is a question about dates.
  where lc.starts_at < p_to and lc.ends_at > p_from
  order by lc.starts_at, cl.sequence, s.name, lc.id
  limit 500
$$;

comment on function public.live_classes_between(timestamptz, timestamptz) is
  'Live lessons overlapping a window, as the caller may see them. INVOKER '
  'over row-ownership RLS -- a family is answered with their own children''s '
  'classes, which is the question they are asking. Carries the college''s '
  'timezone so a screen formats the instants where the college is. Bounded '
  'at 500 rows and ordered totally.';

revoke all on function public.live_classes_between(timestamptz, timestamptz) from public, anon;
grant execute on function public.live_classes_between(timestamptz, timestamptz) to authenticated;

commit;
