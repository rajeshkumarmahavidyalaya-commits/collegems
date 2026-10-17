-- 0360: the day a screen is about, for the app.
--
-- The student record, the family's pages and a staff member's seat each pick
-- "the arrangement current today" in TypeScript (isCurrentArrangement), from
-- mobile_today() or the server's own date. With an earlier year open (0355)
-- every seat in it has ended by today, so the record showed no bus and no bed
-- for a year in which the child had both. They ask this instead: the school's
-- today in the working year, and the open year's boundary otherwise (0358).

begin;

create function public.screen_day()
returns date
language sql
stable
set search_path = ''
as $$
  select public.screen_day_or(public.mobile_today())
$$;

comment on function public.screen_day() is
  'The school''s today in the working year; the last day of an earlier year (or the first of a later one) while it is open to read (0360).';

revoke all on function public.screen_day() from public;
grant execute on function public.screen_day() to anon, authenticated, service_role;

commit;
