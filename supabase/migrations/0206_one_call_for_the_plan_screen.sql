-- 0206 — One call for the plan screen
--
-- `0205` shipped `subscription_usage()` and left the screen to fetch the plan
-- and the subscription beside it. Two problems with that, and the first is not
-- a preference:
--
--   * **`reference` is not exposed to PostgREST.** Every other catalogue in this
--     schema — reports, checks, settings — is read through a function for that
--     reason (`report_list()`), and a page calling `.from("plans")` would have
--     404'd against a table that is right there in the database. Caught by
--     reading how `reference.reports` is served rather than by running it, but
--     it would have been a broken screen.
--   * **It is a glance, not a lookup** — rule 11's dashboard argument. The plan
--     screen answers "what am I on, what am I using, how close am I" all at
--     once and takes no parameters, so it is one round trip returning one
--     document, not three queries a page has to keep consistent.
--
-- `SECURITY INVOKER`, so RLS decides: `subscriptions` is readable by members of
-- the school and nobody else, and the usage counts are of the caller's own
-- tenant's rows. No `where tenant_id =` anywhere in it (rule 11).

begin;

create or replace function public.subscription_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'subscription', (
      select to_jsonb(x)
      from (
        select s.plan_code, s.status, s.trial_ends_on, s.current_period_end
        from public.subscriptions s
        where s.tenant_id = public.current_tenant_id()
      ) x
    ),
    'plan', (
      select to_jsonb(y)
      from (
        select p.code, p.name, p.description, p.price_minor, p.currency, p.bill_every, p.limits
        from public.subscriptions s
        join reference.plans p on p.code = s.plan_code
        where s.tenant_id = public.current_tenant_id()
      ) y
    ),
    'usage', coalesce(
      (select jsonb_agg(to_jsonb(u) order by u.resource) from public.subscription_usage() u),
      '[]'::jsonb
    ),
    -- Every plan a school could move to, so the screen can say what upgrading
    -- would buy without a second call. Bespoke plans (`is_public = false`) are
    -- deliberately absent: a district that negotiated a price should not have it
    -- advertised to everybody else.
    'available', coalesce(
      (select jsonb_agg(to_jsonb(z) order by z.sort)
       from (
         select p.code, p.name, p.description, p.price_minor, p.currency, p.bill_every, p.limits, p.sort
         from reference.plans p
         where p.is_public
       ) z),
      '[]'::jsonb
    )
  );
$$;

comment on function public.subscription_overview() is
  'The plan screen in one round trip: what this school is on, what it is using, '
  'and what else it could move to. SECURITY INVOKER -- `subscriptions` is '
  'readable by members of the school through its policy, and the usage counts '
  'are of the caller''s own rows.';

revoke all on function public.subscription_overview() from public, anon;
grant execute on function public.subscription_overview() to authenticated;

commit;
