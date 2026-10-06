-- 0346: A family has its own dashboard, and what it reads.
--
-- The reference gives a student and a parent a Student (or Parent) Dashboard
-- with its own menu: the child's profile, a session fee summary, attendance,
-- the bus, notices, a calendar, and pages for fee structure, payments, books,
-- exams, certificates, attendance, stationery and contact details. Here a
-- family signed in to the staff dashboard with their own rows in it, so
-- "Students with Dues: 1" was their own child. The page is the app's; this
-- migration is what it reads, and two read gaps the walk found.
--
--   1. `family_owns_student(student)`: the one definition of "this is my
--      child, or me". `event_family_may_act` (0343) was that test under an
--      event's name and now calls it, so a fourth copy is not written.
--   2. `stock_movements` was readable by every member, so every family could
--      read every sale and its `sold_to_student_id` (0261). Staff keep the
--      table; a family reads only their own child's purchases. No family
--      screen read it before, so nothing is taken away from anybody.
--   3. A parent could not see their child's library card or loans: both
--      policies key on the login's own student or staff record. A guardian
--      policy beside each.
--   4. `family_fee_structure(student)`: the reference's Fee Structure (fee
--      type, amount, period, occurrences, session total). Definer, because a
--      family cannot read `student_type_assignments` (finance only, 0281) and
--      the type decides which fee row applies. Occurrences are counted from
--      the billing periods that collect the frequency, never inferred: a
--      ten-month year is real (rule 6). Annual and one-time are once.
--   5. `family_guardians(student)`: the child's guardians' names and phones
--      for the profile card. A student cannot read a guardian's `people` row.
--   6. `family_exam_papers(student)`: every paper of this year's exams the
--      child sits, with its date, period and, from a published plan only,
--      the room and seat. Exam timetable and admit card read the same rows.
--      INVOKER: every table it reads is tenant-wide or row-owned by the
--      family, so another family's child returns nothing.
--   7. `family_update_contact(student, ...)`: a family corrects the child's
--      phone and address. Not the name or the email: a name is the school's
--      record, and the email is what a login is matched by (rule 3). Definer,
--      because `people` has no family write policy, deliberately; adding one
--      would let a family rewrite a name. `family_update_my_contact` is the
--      guardian's own phone and occupation.

begin;

-- ---------------------------------------------------------------------------
-- 1. My child, or me

create function public.family_owns_student(p_student_id uuid)
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

comment on function public.family_owns_student(uuid) is
  'True when the caller is this student, or a guardian of this student, in the caller''s own college. The one definition; event_family_may_act calls it (0346).';

revoke all on function public.family_owns_student(uuid) from public, anon;
grant execute on function public.family_owns_student(uuid) to authenticated;

create or replace function public.event_family_may_act(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.family_owns_student(p_student_id);
$$;

-- ---------------------------------------------------------------------------
-- 2. Stock movements: staff read them; a family reads only its own purchases

alter policy "tenant members view stock_movements" on public.stock_movements
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) not in ('parent', 'student')
  );
alter policy "tenant members view stock_movements" on public.stock_movements
  rename to "staff view stock_movements";

create policy "families view their children's purchases" on public.stock_movements
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and kind = 'sale'
    and sold_to_student_id in (
      select up.student_id from public.user_profiles up
      where up.id = (select auth.uid()) and up.student_id is not null
      union
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. A parent sees their child's library card and loans

create policy "guardians view their children's library cards" on public.members
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

create policy "guardians view their children's book_issues" on public.book_issues
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and member_id in (
      select m.id from public.members m
      join public.guardian_student gs on gs.student_id = m.student_id
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Fee structure

create function public.family_fee_structure(p_student_id uuid)
returns table (
  fee_head_id uuid,
  fee_head text,
  amount numeric,
  frequency text,
  occurrences integer,
  session_total numeric
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_class_level uuid;
  v_type uuid;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not (public.family_owns_student(p_student_id) or public.role_has_permission('fees.collect')) then
    raise exception 'You can see the fee structure of your own child only.' using errcode = '42501';
  end if;

  -- Tenant by hand in every read: no policy runs in here.
  select s.id into v_session from public.academic_sessions s
  where s.tenant_id = v_tenant and s.is_current;
  select sec.class_level_id into v_class_level
  from public.enrolments e
  join public.sections sec on sec.id = e.section_id and sec.tenant_id = v_tenant
  where e.tenant_id = v_tenant and e.student_id = p_student_id
    and e.session_id = v_session and e.status = 'active'
  limit 1;
  select a.student_type_id into v_type from public.student_type_assignments a
  where a.tenant_id = v_tenant and a.student_id = p_student_id and a.session_id = v_session;

  return query
  select fs.fee_head_id,
         fh.name,
         fs.amount,
         fs.frequency,
         n.occurrences,
         case when n.occurrences is null then null else fs.amount * n.occurrences end
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id and fh.tenant_id = v_tenant
  cross join lateral (
    select case
      when fs.frequency in ('annual', 'one_time') then 1
      else nullif((
        select count(*)::integer from public.fee_instalments fi
        where fi.tenant_id = v_tenant and fi.session_id = v_session
          and fi.is_active and fs.frequency = any (fi.collects)
      ), 0)
    end as occurrences
  ) n
  where fs.tenant_id = v_tenant
    and fs.session_id = v_session
    and fs.class_level_id = v_class_level
    and fh.is_active
    and fs.amount > 0
    -- A typed row replaces the regular one for that kind of student (0281).
    and (
      fs.student_type_id = v_type
      or (
        fs.student_type_id is null
        and not exists (
          select 1 from public.fee_structures o
          where o.tenant_id = v_tenant and o.session_id = fs.session_id
            and o.class_level_id = fs.class_level_id and o.fee_head_id = fs.fee_head_id
            and o.student_type_id = v_type
        )
      )
    )
  order by fh.name, fs.fee_head_id;
end;
$$;

comment on function public.family_fee_structure(uuid) is
  'What this child''s class pays this year, per fee head: amount, frequency, how many billing periods collect it, and the session total (null when no period collects a monthly or quarterly fee yet). DEFINER: a family cannot read the student type that decides the row. Own child, or fees.collect (0346).';

revoke all on function public.family_fee_structure(uuid) from public, anon;
grant execute on function public.family_fee_structure(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The child's guardians, for the profile card

create function public.family_guardians(p_student_id uuid)
returns table (relationship text, full_name text, phone text, occupation text, is_primary boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.family_owns_student(p_student_id) then
    raise exception 'You can see the guardians of your own child only.' using errcode = '42501';
  end if;
  return query
  select gs.relationship,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         p.phone,
         g.occupation,
         gs.is_primary
  from public.guardian_student gs
  join public.guardians g on g.id = gs.guardian_id and g.tenant_id = v_tenant
  join public.people p on p.id = g.person_id and p.tenant_id = v_tenant
  where gs.tenant_id = v_tenant and gs.student_id = p_student_id
  order by gs.is_primary desc, gs.relationship, p.first_name;
end;
$$;

comment on function public.family_guardians(uuid) is
  'The guardians of the caller''s own child: relationship, name, phone, occupation. DEFINER: a student cannot read a guardian''s people row. Projects nothing else (0346).';

revoke all on function public.family_guardians(uuid) from public, anon;
grant execute on function public.family_guardians(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The papers a child sits this year

create function public.family_exam_papers(p_student_id uuid)
returns table (
  exam_id uuid,
  exam_name text,
  exam_status text,
  centre text,
  starts_on date,
  ends_on date,
  exam_subject_id uuid,
  subject text,
  code text,
  exam_date date,
  starts_at time,
  ends_at time,
  slot text,
  max_marks numeric,
  room text,
  seat_no integer
)
language sql
stable
set search_path = public, extensions
as $$
  select x.id, x.name, x.status, x.centre, x.starts_on, x.ends_on,
         es.id, sub.name, sub.code, es.exam_date, ts.starts_at, ts.ends_at, ts.label, es.max_marks,
         seat.room_name, seat.seat_no
  from public.enrolments e
  join public.sections sec on sec.id = e.section_id
  join public.exam_subjects es on es.section_id = e.section_id and es.session_id = e.session_id
  join public.exams x on x.id = es.exam_id
  join public.subjects sub on sub.id = es.subject_id
  left join public.time_slots ts on ts.id = es.time_slot_id
  left join lateral (
    select a.room_name, a.seat_no
    from public.exam_seat_allocations a
    where a.student_id = e.student_id and a.exam_subject_id = es.id and a.run_status = 'published'
    limit 1
  ) seat on true
  where e.student_id = p_student_id
    and e.session_id = public.current_session_id(public.current_tenant_id())
    and e.status = 'active'
    and public.student_takes_subject(e.student_id, es.subject_id, e.session_id, sec.class_level_id)
  order by x.starts_on nulls last, x.name, x.id, es.exam_date nulls last, ts.starts_at nulls last, sub.name, es.id;
$$;

comment on function public.family_exam_papers(uuid) is
  'Every paper of this year''s exams the child sits (electives by student_takes_subject), with date, period and the room and seat from a published plan only. Read by the family''s exam timetable and admit card. INVOKER over row-owned enrolments, so another child returns nothing (0346).';

revoke all on function public.family_exam_papers(uuid) from public, anon;
grant execute on function public.family_exam_papers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Contact details a family may correct

create function public.family_update_contact(
  p_student_id uuid,
  p_phone text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_country text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_person uuid;
  v_rows integer;
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.family_owns_student(p_student_id) then
    raise exception 'You can correct the details of your own child only.' using errcode = '42501';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+() -]{6,20}$' then
    raise exception 'A phone number is 6 to 20 digits, spaces or + ( ) -.' using errcode = '22023';
  end if;
  if length(coalesce(p_address_line1, '') || coalesce(p_address_line2, '') || coalesce(p_city, '')
            || coalesce(p_state, '') || coalesce(p_postal_code, '') || coalesce(p_country, '')) > 600 then
    raise exception 'The address is too long.' using errcode = '22023';
  end if;

  select st.person_id into v_person from public.students st
  where st.id = p_student_id and st.tenant_id = v_tenant;

  update public.people
  set phone = v_phone,
      address_line1 = nullif(btrim(coalesce(p_address_line1, '')), ''),
      address_line2 = nullif(btrim(coalesce(p_address_line2, '')), ''),
      city = nullif(btrim(coalesce(p_city, '')), ''),
      state = nullif(btrim(coalesce(p_state, '')), ''),
      postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
      country = nullif(btrim(coalesce(p_country, '')), '')
  where id = v_person and tenant_id = v_tenant;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Those details were not saved.' using errcode = '42501';
  end if;
end;
$$;

comment on function public.family_update_contact(uuid, text, text, text, text, text, text, text) is
  'A family corrects their own child''s phone and address. Not the name (the school''s record) and not the email (what a login is matched by). DEFINER because people has no family write policy, on purpose: one would let a family rewrite a name (0346).';

create function public.family_update_my_contact(p_phone text, p_occupation text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_guardian uuid;
  v_person uuid;
  v_rows integer;
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  select up.guardian_id into v_guardian from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant;
  if v_guardian is null then
    raise exception 'Only a parent''s login has a guardian record to correct.' using errcode = '42501';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+() -]{6,20}$' then
    raise exception 'A phone number is 6 to 20 digits, spaces or + ( ) -.' using errcode = '22023';
  end if;
  if length(coalesce(p_occupation, '')) > 100 then
    raise exception 'An occupation is at most 100 characters.' using errcode = '22023';
  end if;

  select g.person_id into v_person from public.guardians g where g.id = v_guardian and g.tenant_id = v_tenant;
  update public.people set phone = v_phone where id = v_person and tenant_id = v_tenant;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Your details were not saved.' using errcode = '42501';
  end if;
  update public.guardians set occupation = nullif(btrim(coalesce(p_occupation, '')), '')
  where id = v_guardian and tenant_id = v_tenant;
end;
$$;

comment on function public.family_update_my_contact(text, text) is
  'A parent corrects their own phone and occupation on their guardian record. DEFINER for the reason family_update_contact is (0346).';

revoke all on function public.family_update_contact(uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.family_update_my_contact(text, text) from public, anon;
grant execute on function public.family_update_contact(uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.family_update_my_contact(text, text) to authenticated;

commit;
