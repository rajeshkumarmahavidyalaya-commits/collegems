-- 0355: an earlier year can be opened, and is read, not written.
--
-- Reported by the college: "after promotion of students, their previous data
-- is vanished". Measured in that college on 17 Oct 2026, nothing had
-- vanished. 2025-2026 still held 302 enrolments, 6,000 register rows, 2,683
-- marks, 301 results, 344 invoices, 327 ledger entries, its timetable,
-- homework, bus seats and library loans. What changed was the flag: the
-- rollover's last step makes the new year current, and almost every screen
-- (114 SQL read models through current_session_id(), and 141 reads in the app
-- through the same answer) asks only for the current year. The data was
-- filed by year all along and nothing could open the year it was filed under.
--
-- CLAUDE.md rule 2 refused a year picker for a reason that still holds: "a
-- browser-side session picker would show one year while every write filed
-- into another". So this is not a picker over the writes. It is a way to read
-- an earlier year, and Postgres makes it read-only:
--
-- 1. The app sends the year a person has chosen to look at as a request
--    header, `x-schoolos-year`. `viewing_session_id()` reads it, and ignores it
--    unless it names a year of the caller's own college.
-- 2. `current_session_id()` answers with that year when there is one. Every
--    read model that asks "this year" therefore answers about the year on
--    screen, without editing any of them.
-- 3. `request_year_guard()` is PostgREST's pre-request hook. When the year on
--    screen is not the working year, it makes the request's transaction
--    read-only, so every write fails with 25006. That covers an insert, an
--    update, a definer function and a trigger alike, whichever screen sent
--    it. A year is filed into only while it is the working year.
--
-- Nothing reaches this without the header: pg_cron, the job worker, the Edge
-- Functions and the webhooks never send it, and keep the working year. A
-- browser could send the header to PostgREST directly; it would see an
-- earlier year of its own college, which RLS already lets it read by
-- session_id, and could write nothing.
--
-- The guard runs before every request, so it must never raise. It fails
-- open to "no year chosen", the behaviour before this migration, and never
-- to an error on every screen.

begin;

create or replace function public.viewing_session_id(p_tenant_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_header text;
  v_id uuid;
begin
  begin
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-schoolos-year';
  exception when others then
    return null;
  end;
  if v_header is null or v_header !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  select s.id into v_id from public.academic_sessions s
  where s.id = v_header::uuid and s.tenant_id = p_tenant_id;
  return v_id;
end;
$$;

comment on function public.viewing_session_id(uuid) is
  'The year a person has chosen to look at (the x-schoolos-year request header), when it is a year of this college; else null (0355).';

create or replace function public.current_session_id(p_tenant_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    public.viewing_session_id(p_tenant_id),
    (select id from public.academic_sessions where tenant_id = p_tenant_id and is_current limit 1)
  )
$$;

comment on function public.current_session_id(uuid) is
  'The year on screen: the one a person chose to look at, else the working year the college has switched to. Writes happen only in the working year: request_year_guard makes any other year read-only (0355).';

create or replace function public.request_year_guard()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_view uuid;
begin
  begin
    v_tenant := public.current_tenant_id();
    if v_tenant is null then
      return;
    end if;
    v_view := public.viewing_session_id(v_tenant);
    if v_view is null
       or exists (select 1 from public.academic_sessions s where s.id = v_view and s.is_current) then
      return;
    end if;
  exception when others then
    return;
  end;
  perform set_config('transaction_read_only', 'on', true);
end;
$$;

comment on function public.request_year_guard() is
  'PostgREST pre-request hook: a request looking at a year other than the working one runs read-only, so nothing is filed into a year by looking at it (0355).';

revoke all on function public.viewing_session_id(uuid) from public;
revoke all on function public.request_year_guard() from public;
grant execute on function public.viewing_session_id(uuid) to anon, authenticated, service_role;
grant execute on function public.request_year_guard() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.request_year_guard';

commit;

notify pgrst, 'reload config';
