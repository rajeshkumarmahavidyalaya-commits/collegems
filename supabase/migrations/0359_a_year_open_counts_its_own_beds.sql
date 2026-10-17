-- 0359: with a year open, the hostel counts that year's beds.
--
-- 0358 asked the hostel functions about the last day of an earlier year. Rooms
-- are not kept per year, so a bed booked for 2026-2027 (ending in 2027) also
-- passed `effective_ends_on >= 31 March 2026`. Measured in the college that
-- reported the problem: 14 boarders shown for 2025-2026, which had 13, the
-- fourteenth named with their 2026-2027 class.
--
-- While a year is open to read, a bed counts only if it was booked in that
-- year. In the working year no year is open (the app sends no header), so
-- `coalesce(..., a.session_id)` compares a column to itself and nothing
-- changes, future bookings included, as hostel capacity needs.

begin;

do $$
declare
  r record;
  v_def text;
  v_found integer;
  v_pattern text := 'a\.effective_ends_on >= \(select public\.screen_day_or\(current_date\)\)';
begin
  for r in select * from (values ('hostel_occupancy'), ('hostel_register')) as t(fn)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.proname = r.fn and p.pronamespace = 'public'::regnamespace;
    select count(*) into v_found from regexp_matches(v_def, v_pattern, 'g');
    if v_found <> 1 then
      raise exception '0359: % has % matches, expected 1; its body changed since 0358', r.fn, v_found;
    end if;
    execute regexp_replace(
      v_def, v_pattern,
      'a.effective_ends_on >= (select public.screen_day_or(current_date))'
      || ' and a.session_id = coalesce((select public.viewing_session_id(public.current_tenant_id())), a.session_id)',
      'g');
  end loop;
end;
$$;

commit;
