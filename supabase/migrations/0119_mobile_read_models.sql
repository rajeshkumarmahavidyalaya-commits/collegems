-- ---------------------------------------------------------------------------
-- The mobile API -- one call per screen
-- ---------------------------------------------------------------------------
--
-- THERE IS ALREADY AN API. That is the first thing to be honest about: a phone
-- signs in with Supabase Auth and reads tables through PostgREST, and RLS is
-- the same boundary it is for the web app. Nothing here exists to add security;
-- inventing a second authorization layer for mobile would be inventing a second
-- place to get it wrong.
--
-- What a phone needs and does not have is **shape and cost**. A parent opening
-- the app on a train wants one screen: her two children, today's lessons, what
-- is owed, what homework is due, whether anybody was marked absent. Assembled
-- from tables that is eleven round trips over a connection that drops; assembled
-- here it is one, and the assembling happens next to the data, which is the same
-- argument `exams_report_cards` and `notify_outbox` already make.
--
-- THREE CALLS, AND THAT IS THE WHOLE SURFACE
--
--   mobile_bootstrap()          who am I, which school, what may I do
--   mobile_home()               the one screen, for every child at once
--   mobile_student(student_id)  one child, in more detail
--
-- Each returns a single `jsonb` document and each is SECURITY INVOKER, so RLS
-- decides what goes in it. There is no `where tenant_id =` written by hand
-- anywhere below -- that is rule 11's read-model rule, and it applies with more
-- force here because these are the widest read paths in the system.
--
-- VERSIONING, WHICH MATTERS MORE THAN IT DOES ON THE WEB
--
-- A web client is redeployed with the server. A phone is not: a parent runs
-- last April's build until she reinstalls. So the contract is:
--
--   * every document carries `api_version`
--   * **additive changes only** within a version -- a new key is safe, a
--     renamed or removed one is not
--   * a breaking change is a new function (`mobile_home_v2`), and the old one
--     keeps working until the store analytics say nobody is on it
--
-- `min_supported_version` in the bootstrap document is the other half: a build
-- older than that is told to update rather than being left to render a screen
-- from keys that no longer exist.
--
-- BOUNDED, per rule 7, and the bounds are in the document rather than in a
-- comment: at most 10 children, 20 homework items, 10 notices, 8 exam results.
-- A family larger than that is real; a *response* larger than that is a bug.

-- ---------------------------------------------------------------------------
-- Today, where the school is
-- ---------------------------------------------------------------------------

-- Vercel runs in UTC and Supabase runs in UTC; the school does not, and neither
-- does the phone. `tenants.timezone` is the only correct answer to "what is
-- today's timetable", and computing it in Node from the handset's clock is how
-- a parent in Dubai sees Tuesday's lessons on Monday evening.
create or replace function public.mobile_today()
returns date
language sql
stable
set search_path = public, extensions
as $$
  select (now() at time zone t.timezone)::date
  from public.tenants t
  where t.id = ( select public.current_tenant_id() )
$$;

revoke all on function public.mobile_today() from public, anon;
grant execute on function public.mobile_today() to authenticated;

-- ---------------------------------------------------------------------------
-- The children this login is a family member of
-- ---------------------------------------------------------------------------

-- Deliberately NOT "the students this login can see". RLS lets a teacher see
-- every child they teach and an administrator see all of them, and neither of
-- those is a home screen -- "my children" is a relationship, not a visibility.
-- So the relationship is spelled out, and a member of staff gets an empty list
-- here even though they can read the same rows elsewhere.
create or replace function public.mobile_my_students()
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  photo_path text,
  section_id uuid,
  section_label text,
  roll_number text,
  relationship text
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select up.tenant_id, up.student_id, up.guardian_id
    from public.user_profiles up
    where up.id = ( select auth.uid() )
  ),
  mine as (
    select me.student_id, 'self'::text as relationship
    from me where me.student_id is not null
    union all
    select gs.student_id, gs.relationship
    from me
    join public.guardian_student gs on gs.guardian_id = me.guardian_id
    where me.guardian_id is not null
  )
  select
    s.id,
    s.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    p.photo_path,
    en.section_id,
    (cl.name || ' ' || sec.name)::text,
    en.roll_number,
    mine.relationship
  from mine
  join public.students s on s.id = mine.student_id
  join public.people p on p.id = s.person_id
  left join public.enrolments en
    on en.student_id = s.id
   and en.status = 'active'
   and en.session_id = public.current_session_id(( select public.current_tenant_id() ))
  left join public.sections sec on sec.id = en.section_id
  left join public.class_levels cl on cl.id = sec.class_level_id
  order by cl.sequence nulls last, en.roll_number nulls last, p.first_name
  limit 10
$$;

revoke all on function public.mobile_my_students() from public, anon;
grant execute on function public.mobile_my_students() to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------

-- Called once at app start. Everything a client needs before it can render
-- anything: which school, which year, who I am, what I may do, and whether this
-- build is still supported.
create or replace function public.mobile_bootstrap()
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'api_version', 1,
    -- Raise this when a released build can no longer render the document.
    -- Never lower it: a client that has been told to update and then told it
    -- need not have is worse than either answer on its own.
    'min_supported_version', 1,
    'today', public.mobile_today(),
    'school', (
      select jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'timezone', t.timezone)
      from public.tenants t where t.id = ( select public.current_tenant_id() )
    ),
    'session', (
      select jsonb_build_object(
        'id', a.id, 'name', a.name, 'starts_on', a.start_date, 'ends_on', a.end_date)
      from public.academic_sessions a
      where a.id = public.current_session_id(( select public.current_tenant_id() ))
    ),
    'me', (
      select jsonb_build_object(
        'user_id', up.id,
        'role', ( select public.current_role_code() ),
        'name', case when p.id is null then null
                else (p.first_name || ' ' || p.last_name)::text end,
        'photo_path', p.photo_path,
        'is_student', up.student_id is not null,
        'is_guardian', up.guardian_id is not null,
        'is_staff', up.staff_id is not null
      )
      from public.user_profiles up
      left join public.people p on p.id = up.person_id
      where up.id = ( select auth.uid() )
    ),
    -- The permission matrix, so a client can hide what it must not offer. It
    -- is a convenience, exactly as it is on the web: RLS is the boundary and a
    -- client that ignores this list still cannot read anything.
    'permissions', coalesce((
      select jsonb_agg(rp.permission_code order by rp.permission_code)
      from public.role_permissions rp
      join public.user_profiles up on up.role_id = rp.role_id
      where up.id = ( select auth.uid() )
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(to_jsonb(m)) from public.mobile_my_students() m
    ), '[]'::jsonb),
    -- Which channels this school can actually reach them on, so a preferences
    -- screen on a phone tells the same truth the web one does.
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel', c.channel,
        'is_enabled', c.is_enabled,
        'provider_configured', c.provider_configured
      ) order by c.channel)
      from public.notify_channel_status() c
    ), '[]'::jsonb),
    'unread_notifications', public.notify_unread_count()
  )
$$;

revoke all on function public.mobile_bootstrap() from public, anon;
grant execute on function public.mobile_bootstrap() to authenticated;

-- ---------------------------------------------------------------------------
-- One child, for the home screen
-- ---------------------------------------------------------------------------

-- Factored out because `mobile_home` needs it once per child and
-- `mobile_student` needs it once, and two implementations of "what does this
-- child's day look like" would be free to disagree -- the same argument
-- `fees_billable_lines` makes about invoices.
--
-- Every part of this wraps a module's own read path rather than recomputing it,
-- per rule 11: a phone that disagreed with the screen the money is taken on
-- would be worse than a phone with no fee balance at all.
create or replace function public.mobile_student_card(p_student_id uuid, p_on date default null)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with day as (select coalesce(p_on, public.mobile_today()) as on_date),
  student as (
    select * from public.mobile_my_students() m where m.student_id = p_student_id
  )
  select jsonb_build_object(
    'student', to_jsonb(s),
    'timetable_today', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period', t.period_number,
        'slot', t.slot_label,
        'starts_at', t.starts_at,
        'ends_at', t.ends_at,
        'subject', t.subject_name,
        'subject_code', t.subject_code,
        'teacher', t.teacher_name,
        'room', t.room_name
      ) order by t.period_number)
      from day, public.timetable_for_section(s.section_id) t
      where t.weekday = extract(isodow from day.on_date)::integer
    ), '[]'::jsonb),
    'attendance', (
      select to_jsonb(a) from public.exams_attendance_summary(
        p_student_id,
        public.current_session_id(( select public.current_tenant_id() )),
        (select on_date from day)
      ) a
    ),
    'fees', (
      select jsonb_build_object(
        'charged', b.charged, 'paid', b.paid, 'balance', b.balance,
        'last_payment_at', b.last_payment_at)
      from public.fees_student_balances(s.section_id, false) b
      where b.student_id = p_student_id
    ),
    'homework_due', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.homework_id,
        'title', h.title,
        'subject', h.subject_name,
        'due_on', h.due_on,
        'status', h.status,
        'collects_submissions', h.collects_submissions
      ) order by h.due_on)
      from (
        select * from public.homework_for_student(p_student_id, false) hh
        order by hh.due_on limit 20
      ) h
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exam_id', r.exam_id,
        'exam', r.exam_name,
        'ends_on', r.ends_on,
        'percentage', r.percentage,
        'grade', r.grade,
        'result', r.result,
        'rank_in_cohort', r.rank_in_cohort,
        'cohort_size', r.cohort_size
      ) order by r.published_at desc)
      from (
        select * from public.exams_published_for_student(p_student_id) rr
        order by rr.published_at desc limit 8
      ) r
    ), '[]'::jsonb),
    'transport', (
      select to_jsonb(tr) from public.transport_for_student(p_student_id) tr limit 1
    ),
    'hostel', (
      select to_jsonb(ho) from public.hostel_for_student(p_student_id) ho limit 1
    )
  )
  from student s
$$;

revoke all on function public.mobile_student_card(uuid, date) from public, anon;
grant execute on function public.mobile_student_card(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The home screen
-- ---------------------------------------------------------------------------

create or replace function public.mobile_home(p_on date default null)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'api_version', 1,
    'on', coalesce(p_on, public.mobile_today()),
    'unread_notifications', public.notify_unread_count(),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'delivery_id', n.id,
        'subject', n.subject,
        'body', n.body,
        'event_key', n.event_key,
        'event_name', n.event_name,
        'created_at', n.created_at,
        'read_at', n.read_at
      ) order by n.created_at desc)
      from public.notify_inbox(10, false) n
    ), '[]'::jsonb),
    'children', coalesce((
      select jsonb_agg(public.mobile_student_card(m.student_id, p_on))
      from public.mobile_my_students() m
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.mobile_home(date) from public, anon;
grant execute on function public.mobile_home(date) to authenticated;

-- ---------------------------------------------------------------------------
-- One child, in detail
-- ---------------------------------------------------------------------------

-- The card, plus the things a person taps through to: the whole week's
-- routine rather than today's, and the fee documents behind the balance.
--
-- `exams_may_see_student` is the gate rather than a hand-written check, because
-- it is the same question the report card asks and a second answer would
-- eventually be a different answer.
create or replace function public.mobile_student(p_student_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select case
    when not public.exams_may_see_student(p_student_id) then null
    else (
      select public.mobile_student_card(p_student_id, null) || jsonb_build_object(
        'api_version', 1,
        'timetable_week', coalesce((
          select jsonb_agg(jsonb_build_object(
            'weekday', t.weekday,
            'period', t.period_number,
            'starts_at', t.starts_at,
            'ends_at', t.ends_at,
            'subject', t.subject_name,
            'teacher', t.teacher_name,
            'room', t.room_name
          ) order by t.weekday, t.period_number)
          from public.enrolments en, public.timetable_for_section(en.section_id) t
          where en.student_id = p_student_id and en.status = 'active'
            and en.session_id = public.current_session_id(( select public.current_tenant_id() ))
        ), '[]'::jsonb),
        'invoices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'number', i.invoice_number,
            'issued_on', i.issue_date,
            'due_on', i.due_date,
            'status', i.status,
            -- An invoice has no total column: it is the sum of its lines, for
            -- the same reason quantity on hand is a sum and not a column.
            'total', (
              select coalesce(sum(l.amount), 0)
              from public.invoice_lines l where l.invoice_id = i.id
            )
          ) order by i.issue_date desc)
          from (
            select * from public.invoices iv
            where iv.student_id = p_student_id
            order by iv.issue_date desc limit 12
          ) i
        ), '[]'::jsonb)
      )
    )
  end
$$;

revoke all on function public.mobile_student(uuid) from public, anon;
grant execute on function public.mobile_student(uuid) to authenticated;
