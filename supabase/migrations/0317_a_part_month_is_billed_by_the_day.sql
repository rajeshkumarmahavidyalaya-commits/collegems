-- 0317: a bus seat or a hostel bed that runs for part of a month is billed for
-- the part it ran.
--
-- `transport_fee_lines` and `hostel_fee_lines` answer "is this arrangement
-- running on one date?", and `fees_billable_lines` asked it of the first day of
-- the billing period. So, for a monthly instalment:
--
--   * a seat that starts on 2 March was **not billed for March at all** -- the
--     child rode for thirty days free;
--   * a seat that ends on 3 March was billed for the whole of March;
--   * a child who changed stop on the 15th was billed the first stop's fare
--     and nothing for the second.
--
-- Measured on the demo college: one live hostel bed starts on a day other than
-- the 1st, so its first month would have gone unbilled.
--
-- ## What replaces it
--
-- When the instalment says which days it covers (`period_start` and
-- `period_end`, set on every instalment the demo college has), every
-- arrangement that **overlaps** the period is billed, and how much is the
-- college's decision -- rule 12, so it is a setting, not a branch:
--
--   * `fees.part_month.by_days` on (the default): the monthly fare times the
--     days the arrangement ran in the period over the days in the period,
--     rounded to the paisa. A full month is exactly the monthly fare, so a
--     child who rode all month sees no change. The line says
--     "12 of 31 days", because a part amount with no reason starts a phone call.
--   * off: a month that is started is charged in full -- the other common
--     practice. An arrangement replaced later in the same period (a change of
--     stop or room) is not charged as well, so a family is never billed two
--     whole months for one.
--
-- The default is the one where the bill equals the days ridden. "A missing key
-- means the conservative reading" (rule 12) is about not surprising a family;
-- the first-day rule did surprise the school, silently, by billing nothing.
--
-- An instalment with no dates, and every caller asking about one day (reports,
-- the conflicts critic, the leaving checks), keep the point-in-time functions
-- unchanged.
--
-- ## Why two new functions rather than a parameter
--
-- Adding a parameter to `transport_fee_lines` would create an overload, and a
-- two-argument call would then be ambiguous between the two. The period
-- question is a different question, so it is a different function, and
-- `fees_billable_lines` -- the one definition of what a child is charged
-- (rule 6) -- picks by whether the instalment has dates. Preview and invoice
-- both go through it, so they cannot disagree.

begin;

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'fees.part_month',
  'Part-month bus and hostel fees',
  'When a bus seat or hostel bed starts or ends part way through a month. '
  'On: charge the days it ran (a seat from the 12th of a 31-day month pays 20 of '
  '31 days). Off: charge any month that was started in full.',
  'Fees',
  'object',
  '[{"name": "by_days", "type": "boolean", "label": "Charge part months by the day"}]'::jsonb,
  '{"by_days": true}'::jsonb,
  false,
  'fees.manage',
  65
)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ transport --

create or replace function public.transport_fee_lines_for_period(
  p_student_id uuid,
  p_from date,
  p_to date
)
returns table (fee_head_id uuid, description text, amount numeric)
language sql
stable
set search_path = public, extensions
as $$
  select
    tr.fee_head_id,
    ('Transport - ' || rs.name || ' (Route ' || tr.code || ')'
      || case when x.days < x.of_days and x.by_days
              then ' - ' || x.days || ' of ' || x.of_days || ' days' else '' end)::text,
    case when x.by_days then round(ta.monthly_fare * x.days / x.of_days, 2)
         else ta.monthly_fare end
  from public.transport_assignments ta
  join public.transport_routes tr on tr.id = ta.route_id
  join public.route_stops rs on rs.id = ta.stop_id
  cross join lateral (
    select (least(ta.effective_ends_on, p_to) - greatest(ta.starts_on, p_from) + 1) as days,
           (p_to - p_from + 1) as of_days,
           coalesce((public.setting_value('fees.part_month') ->> 'by_days')::boolean, true) as by_days
  ) x
  where ta.student_id = p_student_id
    and ta.status = 'active'
    and ta.monthly_fare > 0
    and tr.fee_head_id is not null
    and ta.starts_on <= p_to
    and ta.effective_ends_on >= p_from
    -- A whole month is charged once: in whole-month mode an arrangement
    -- replaced later in the same period gives way to its successor.
    and (
      x.by_days
      or not exists (
        select 1 from public.transport_assignments n
        where n.tenant_id = ta.tenant_id
          and n.student_id = ta.student_id
          and n.status = 'active'
          and n.id <> ta.id
          and n.starts_on > ta.starts_on
          and n.starts_on <= p_to
          and n.effective_ends_on >= p_from
      )
    )
$$;

comment on function public.transport_fee_lines_for_period(uuid, date, date) is
  'Bus fares a child owes for one billing period, part months by the day or in full per fees.part_month (0317). The point-in-time question is transport_fee_lines.';

revoke all on function public.transport_fee_lines_for_period(uuid, date, date) from public, anon;
grant execute on function public.transport_fee_lines_for_period(uuid, date, date) to authenticated;

-- --------------------------------------------------------------------- hostel --

create or replace function public.hostel_fee_lines_for_period(
  p_student_id uuid,
  p_from date,
  p_to date
)
returns table (fee_head_id uuid, description text, amount numeric)
language sql
stable
set search_path = public, extensions
as $$
  select
    h.fee_head_id,
    ('Hostel - ' || h.name || ' room ' || r.room_number
      || case when x.days < x.of_days and x.by_days
              then ' - ' || x.days || ' of ' || x.of_days || ' days' else '' end)::text,
    case when x.by_days then round(a.monthly_fare * x.days / x.of_days, 2)
         else a.monthly_fare end
  from public.hostel_allocations a
  join public.hostels h on h.id = a.hostel_id
  join public.hostel_rooms r on r.id = a.room_id
  cross join lateral (
    select (least(a.effective_ends_on, p_to) - greatest(a.starts_on, p_from) + 1) as days,
           (p_to - p_from + 1) as of_days,
           coalesce((public.setting_value('fees.part_month') ->> 'by_days')::boolean, true) as by_days
  ) x
  where a.student_id = p_student_id
    and a.status = 'active'
    and a.monthly_fare > 0
    and h.fee_head_id is not null
    and a.starts_on <= p_to
    and a.effective_ends_on >= p_from
    and (
      x.by_days
      or not exists (
        select 1 from public.hostel_allocations n
        where n.tenant_id = a.tenant_id
          and n.student_id = a.student_id
          and n.status = 'active'
          and n.id <> a.id
          and n.starts_on > a.starts_on
          and n.starts_on <= p_to
          and n.effective_ends_on >= p_from
      )
    )
$$;

comment on function public.hostel_fee_lines_for_period(uuid, date, date) is
  'Hostel fees a child owes for one billing period, part months by the day or in full per fees.part_month (0317). The point-in-time question is hostel_fee_lines.';

revoke all on function public.hostel_fee_lines_for_period(uuid, date, date) from public, anon;
grant execute on function public.hostel_fee_lines_for_period(uuid, date, date) to authenticated;

-- ------------------------------------------------------- the one definition --

-- Same signature as 0281, so its grants are kept. The structure branch is
-- 0281's, unchanged. Transport and hostel each have two branches now: the
-- period one when the instalment has both dates, the point one otherwise.
create or replace function public.fees_billable_lines(p_student_id uuid, p_instalment_id uuid default null::uuid, p_as_of date default null::date, p_fee_head_ids uuid[] default null::uuid[])
returns table(fee_head_id uuid, description text, amount numeric, source text)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with period as (
    select fi.collects, fi.period_start, fi.period_end, fi.due_date
    from public.fee_instalments fi
    where fi.id = p_instalment_id
  ),
  as_of as (
    select coalesce(
      p_as_of,
      (select coalesce(period_start, due_date) from period),
      current_date
    ) as d
  )
  select fs.fee_head_id,
         (fh.name || coalesce(' (' || st.name || ')', ''))::text,
         fs.amount,
         'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  left join public.student_types st on st.id = fs.student_type_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    and fs.class_level_id = (
      select s.class_level_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      where e.student_id = p_student_id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
      limit 1
    )
    and (
      fs.student_type_id = (
        select a.student_type_id
        from public.student_type_assignments a
        where a.student_id = p_student_id
          and a.session_id = public.current_session_id(public.current_tenant_id())
      )
      or (
        fs.student_type_id is null
        and not exists (
          select 1
          from public.fee_structures o
          where o.tenant_id = fs.tenant_id
            and o.session_id = fs.session_id
            and o.class_level_id = fs.class_level_id
            and o.fee_head_id = fs.fee_head_id
            and o.student_type_id = (
              select a.student_type_id
              from public.student_type_assignments a
              where a.student_id = p_student_id
                and a.session_id = public.current_session_id(public.current_tenant_id())
            )
        )
      )
    )
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where fs.frequency = any (pp.collects))
    )

  union all

  -- Transport, one day: no instalment, or an instalment with no dates.
  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, (select d from as_of)) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
    and not exists (select 1 from period pp where pp.period_start is not null and pp.period_end is not null)
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )

  union all

  -- Transport, a period: every arrangement that overlapped it (0317).
  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from period pp
  cross join lateral public.transport_fee_lines_for_period(p_student_id, pp.period_start, pp.period_end) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where pp.period_start is not null and pp.period_end is not null
    and 'monthly' = any (pp.collects)
    and fh.is_active
    and t.amount > 0
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))

  union all

  select hl.fee_head_id, hl.description, hl.amount, 'hostel'::text
  from public.hostel_fee_lines(p_student_id, (select d from as_of)) hl
  join public.fee_heads fh on fh.id = hl.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or hl.fee_head_id = any (p_fee_head_ids))
    and not exists (select 1 from period pp where pp.period_start is not null and pp.period_end is not null)
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )

  union all

  select hl.fee_head_id, hl.description, hl.amount, 'hostel'::text
  from period pp
  cross join lateral public.hostel_fee_lines_for_period(p_student_id, pp.period_start, pp.period_end) hl
  join public.fee_heads fh on fh.id = hl.fee_head_id
  where pp.period_start is not null and pp.period_end is not null
    and 'monthly' = any (pp.collects)
    and fh.is_active
    and hl.amount > 0
    and (p_fee_head_ids is null or hl.fee_head_id = any (p_fee_head_ids))
$function$;

commit;
