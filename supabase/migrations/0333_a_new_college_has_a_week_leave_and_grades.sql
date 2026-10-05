-- 0333: A new college has a week, kinds of leave and a grading scheme.
--
-- 0332's sweep, run over every table: which configuration does a college made
-- by the product start without, that the demo college had from its seed?
-- Three of them change what the product does, silently:
--
-- * weekends -- a new college has no row, so `attendance_calendar` counts
--   every Sunday as a working day. Payroll prorates over it (an absent
--   Sunday is unpaid), attendance coverage reports every Sunday's register as
--   missing, and the register accepts a Sunday. Nobody chose "we teach every
--   day"; the table was simply empty. Measured: Northgate Test Annex and
--   Rajesh kr Maha have 0 rows; the demo college and Northgate have 7.
-- * leave_types -- with none, no member of staff can apply for leave: the
--   form's "Kind of leave" is required and empty. And `saveLeaveType` had no
--   caller in the application, so nothing could add one either (fixed beside
--   this migration, on /hr/leave).
-- * grading_schemes -- with none, `exams_rules_for` answers `{}`: results are
--   computed with no grade bands and no pass mark, and report cards print no
--   grade. A coherent configuration (rule 12), and not one anybody decided.
--
-- 0300's rule: a default for new colleges is data, applied by a trigger on
-- `tenants`, never a literal list in `college_create`. These are the demo
-- college's own rows, which is to say the product's shipped convention: Sunday
-- off; casual, sick, earned and unpaid leave; the nine-point scale with grace.
--
-- Existing colleges: the weekend rows are backfilled where a college has none,
-- because an empty week is a defect, not a choice. Leave types and grading
-- schemes are *not* backfilled into an existing college: those are a college's
-- own policy, and one that has been running without them gets a button
-- (`leave_types_add_defaults`, on /hr/leave) rather than rows it did not ask for.

begin;

create table reference.weekend_defaults (
  weekday integer primary key check (weekday between 1 and 7),
  is_teaching boolean not null
);
create table reference.leave_type_defaults (
  code text primary key check (code ~ '^[A-Z0-9_]{2,12}$'),
  name text not null,
  annual_quota_days numeric,
  is_paid boolean not null,
  allows_half_day boolean not null,
  sort integer not null
);
create table reference.grading_scheme_defaults (
  name text primary key,
  description text,
  is_default boolean not null,
  rules jsonb not null
);

comment on table reference.weekend_defaults is 'A new college''s week (0333): Monday to Saturday taught, Sunday off.';
comment on table reference.leave_type_defaults is 'A new college''s kinds of staff leave (0333). Also what leave_types_add_defaults() offers an existing one.';
comment on table reference.grading_scheme_defaults is 'A new college''s grading scheme (0333). Without one, exams_rules_for answers {} and results carry no grade.';

revoke all on reference.weekend_defaults, reference.leave_type_defaults, reference.grading_scheme_defaults
  from public, anon, authenticated;
grant select on reference.weekend_defaults, reference.leave_type_defaults, reference.grading_scheme_defaults
  to authenticated;

insert into reference.weekend_defaults (weekday, is_teaching) values
  (1, true), (2, true), (3, true), (4, true), (5, true), (6, true), (7, false);

insert into reference.leave_type_defaults (code, name, annual_quota_days, is_paid, allows_half_day, sort) values
  ('CL', 'Casual leave', 12, true, true, 1),
  ('SL', 'Sick leave', 10, true, true, 2),
  ('EL', 'Earned leave', 15, true, false, 3),
  ('LWP', 'Leave without pay', null, false, true, 4);

insert into reference.grading_scheme_defaults (name, description, is_default, rules) values (
  'Standard (nine-point, with grace)',
  'Eight grade bands, five grace marks in one subject, and an additional subject that can replace a failed compulsory one.',
  true,
  '{"pass": {"aggregate_min_percent": 33},
    "rank": {"scope": "section", "method": "competition", "include": "all"},
    "grace": {"max_marks": 5, "max_subjects": 1},
    "grades": [
      {"code": "A1", "point": 10, "description": "Outstanding", "min_percent": 91},
      {"code": "A2", "point": 9, "description": "Excellent", "min_percent": 81},
      {"code": "B1", "point": 8, "description": "Very good", "min_percent": 71},
      {"code": "B2", "point": 7, "description": "Good", "min_percent": 61},
      {"code": "C1", "point": 6, "description": "Fair", "min_percent": 51},
      {"code": "C2", "point": 5, "description": "Satisfactory", "min_percent": 41},
      {"code": "D", "point": 4, "description": "Pass", "min_percent": 33},
      {"code": "E", "point": 0, "is_fail": true, "description": "Needs improvement", "min_percent": 0}],
    "aggregate": {"method": "weighted"},
    "optional_subject": {"replaces_worst": true}}'::jsonb
);

-- Run by the trigger as the inserting role (college_create is a definer), so
-- it is revoked from every JWT role: nothing holding a token seeds a college.
create or replace function public.college_seed_calendar_defaults(p_tenant_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  insert into public.weekends (tenant_id, weekday, is_teaching)
  select p_tenant_id, d.weekday, d.is_teaching from reference.weekend_defaults d
  on conflict (tenant_id, weekday) do nothing;

  insert into public.leave_types (tenant_id, code, name, annual_quota_days, is_paid, allows_half_day, is_active)
  select p_tenant_id, d.code, d.name, d.annual_quota_days, d.is_paid, d.allows_half_day, true
  from reference.leave_type_defaults d
  order by d.sort
  on conflict (tenant_id, code) do nothing;

  insert into public.grading_schemes (tenant_id, name, description, is_default, rules)
  select p_tenant_id, d.name, d.description, d.is_default, d.rules
  from reference.grading_scheme_defaults d
  where not exists (select 1 from public.grading_schemes g where g.tenant_id = p_tenant_id)
  on conflict (tenant_id, name) do nothing;
end;
$$;

revoke all on function public.college_seed_calendar_defaults(uuid) from public, anon, authenticated;

create or replace function public.tenants_seed_calendar()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform public.college_seed_calendar_defaults(new.id);
  return new;
end;
$$;

revoke all on function public.tenants_seed_calendar() from public, anon, authenticated;

create trigger tenants_seed_calendar
  after insert on public.tenants
  for each row execute function public.tenants_seed_calendar();

-- An existing college's button: the usual kinds of leave, through the
-- caller's own insert policy (INVOKER), skipping any code it already has.
create or replace function public.leave_types_add_defaults()
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_count integer;
begin
  if v_tenant is null then
    raise exception 'No tenant in session' using errcode = '42501';
  end if;
  insert into public.leave_types (tenant_id, code, name, annual_quota_days, is_paid, allows_half_day, is_active)
  select v_tenant, d.code, d.name, d.annual_quota_days, d.is_paid, d.allows_half_day, true
  from reference.leave_type_defaults d
  where not exists (
    select 1 from public.leave_types x
    where x.tenant_id = v_tenant and (x.code = d.code or lower(x.name) = lower(d.name)))
  order by d.sort;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.leave_types_add_defaults() is
  'Adds the usual kinds of staff leave (reference.leave_type_defaults) the caller''s college lacks (0333). INVOKER: the leave_types insert policy decides who may.';

revoke all on function public.leave_types_add_defaults() from public, anon;
grant execute on function public.leave_types_add_defaults() to authenticated;

-- Backfill the week only, and only where a college has none.
insert into public.weekends (tenant_id, weekday, is_teaching)
select t.id, d.weekday, d.is_teaching
from public.tenants t
cross join reference.weekend_defaults d
where not exists (select 1 from public.weekends w where w.tenant_id = t.id);

commit;
