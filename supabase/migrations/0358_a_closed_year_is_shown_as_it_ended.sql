-- 0358: transport and hostel show a closed year as it stood on its last day.
--
-- 0355 lets a person open an earlier year, and 0356 counted its roll. The
-- transport and hostel screens still read as empty there, for a reason one
-- step along: they decide who is on a bus or in a bed by today's date. A seat
-- in 2025-2026 ends on 31 March 2026, and `effective_ends_on >= current_date`
-- is false for every one of them in October. Measured in the college that
-- reported it: 46 seats and 13 beds in 2025-2026, all `active`, none shown.
--
-- So the day those questions are asked about is now the day the screen is
-- about. `screen_day_or(today)` returns `today` in the working year, which is
-- exactly what each function asked before. For an earlier year it returns that
-- year's last day; for a later one, its first day. Each call site wraps it in
-- a scalar subquery, so it is evaluated once per query (0357's lesson).
--
-- The two rosters also name each child's class from an enrolment that had to
-- be `active`, which a closed year's never are; they take the year's roll
-- (0356) instead.
--
-- Like 0356, the rewrite is from each function's live body and checked: each
-- named function must contain exactly the expected number of each pattern, or
-- the migration stops and changes nothing. create or replace keeps grants.

begin;

create function public.screen_day_or(p_today date)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case
              when s.end_date < p_today then s.end_date
              when s.start_date > p_today then s.start_date
            end
     from public.academic_sessions s
     where s.id = public.viewing_session_id(public.current_tenant_id())
       and not s.is_current),
    p_today
  )
$$;

comment on function public.screen_day_or(date) is
  'The day a dated roster is about: p_today in the working year; the last day of an earlier year, or the first day of a later one, while that year is open to read (0358).';

revoke all on function public.screen_day_or(date) from public;
grant execute on function public.screen_day_or(date) to anon, authenticated, service_role;

do $$
declare
  r record;
  v_def text;
  v_found integer;
begin
  for r in
    select * from (values
      ('transport_route_load', 'ta\.effective_ends_on >= current_date', 'ta.effective_ends_on >= (select public.screen_day_or(current_date))', 1),
      ('hostel_occupancy', 'a\.effective_ends_on >= current_date', 'a.effective_ends_on >= (select public.screen_day_or(current_date))', 1),
      ('hostel_register', 'a\.effective_ends_on >= current_date', 'a.effective_ends_on >= (select public.screen_day_or(current_date))', 1),
      ('hostel_register', 'en\.status = ''active''', 'en.status in (''active'', ''promoted'', ''repeated'')', 1),
      ('transport_manifest', 'public\.mobile_today\(\)', '(select public.screen_day_or(public.mobile_today()))', 2),
      ('transport_manifest', 'en\.status = ''active''', 'en.status in (''active'', ''promoted'', ''repeated'')', 1)
    ) as t(fn, pattern, replacement, expected)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.proname = r.fn and p.pronamespace = 'public'::regnamespace;
    if v_def is null then
      raise exception '0358: % does not exist', r.fn;
    end if;
    select count(*) into v_found from regexp_matches(v_def, r.pattern, 'g');
    if v_found <> r.expected then
      raise exception '0358: % has % matches of %, expected %; its body changed since this was written',
        r.fn, v_found, r.pattern, r.expected;
    end if;
    execute regexp_replace(v_def, r.pattern, r.replacement, 'g');
  end loop;
end;
$$;

commit;
