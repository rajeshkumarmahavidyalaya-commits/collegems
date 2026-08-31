-- Hardening from the post-migration security advisor run: pin search_path
-- on every SECURITY DEFINER / helper function (defends against search_path
-- hijacking), move the citext extension out of `public`, and stop the two
-- SECURITY DEFINER trigger functions from being callable directly over
-- PostgREST (/rest/v1/rpc/...) -- they should only ever fire as triggers.

alter function public.current_tenant_id() set search_path = '';
alter function public.current_role_code() set search_path = '';
alter function public.current_session_id(uuid) set search_path = '';
alter function public.set_updated_at() set search_path = '';
alter function public.audit_row_change() set search_path = public;
alter function public.handle_new_auth_user() set search_path = public;

alter extension citext set schema extensions;

revoke execute on function public.audit_row_change() from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
