-- 0315: a trigger function is not an endpoint.
--
-- Supabase's security advisor listed six SECURITY DEFINER functions that the
-- anonymous key could call through /rest/v1/rpc. All six return `trigger`, so
-- a direct call fails before doing anything -- Postgres refuses to run a
-- trigger function outside a trigger -- and `definer_guard_violations()` was
-- right to stay at 0. But a warning that is always explained away is a warning
-- people learn to scroll past, and the next one on that list might be real.
--
-- EXECUTE on a trigger function is checked when the trigger is CREATED, not
-- each time it fires, so revoking it from every JWT role changes nothing about
-- the triggers and removes six lines from the advisor. Probed after applying:
-- the role-permissions guard still fires on an update, as the role it guards.

begin;

revoke all on function public.certificates_stamp_subject() from public, anon, authenticated;
revoke all on function public.jobs_check_enqueue() from public, anon, authenticated;
revoke all on function public.notification_channels_for_new_tenant() from public, anon, authenticated;
revoke all on function public.role_permissions_keep_a_way_back() from public, anon, authenticated;
revoke all on function public.schedule_stamp_creator() from public, anon, authenticated;
revoke all on function public.subscription_enforce_limit() from public, anon, authenticated;

commit;
