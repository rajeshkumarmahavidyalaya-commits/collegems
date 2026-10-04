-- 0327: a school's own details, for its edit form.
--
-- The edit form (0326) is opened by a super admin who may be working in a
-- different college, so it cannot read the school's settings through RLS: the
-- policy sees only the college in the token. school_profile answers for one
-- school the caller administers, and only what the form shows -- the name,
-- the eight contact fields, the logo, the menu switches, whether it is paused
-- and how many classes it has (copying setup is offered only into a school
-- with none). Definer, refusing anybody who does not administer it.

begin;

create or replace function public.school_profile(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.school_require_admin(p_tenant);
  return (
    select jsonb_build_object(
      'tenant_id', t.id,
      'name', t.name,
      'slug', t.slug,
      'logo', t.logo,
      'is_active', t.is_active,
      'profile', coalesce((select s.value from public.settings s where s.tenant_id = t.id and s.key = 'school.profile'), '{}'::jsonb),
      'menu', coalesce((select s.value from public.settings s where s.tenant_id = t.id and s.key = 'modules.menu'), '{}'::jsonb),
      'class_count', (select count(*) from public.class_levels cl where cl.tenant_id = t.id))
    from public.tenants t
    where t.id = p_tenant
  );
end;
$$;

comment on function public.school_profile(uuid) is
  'One school''s name, contact fields, logo, menu switches, pause flag and class count, for its School Management edit form (0327). Definer; refuses anybody who does not administer that school.';

revoke all on function public.school_profile(uuid) from public, anon;
grant execute on function public.school_profile(uuid) to authenticated;

commit;
