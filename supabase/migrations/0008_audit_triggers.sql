-- Generic audit trigger (CLAUDE.md rule 9): writes old/new row JSON, actor,
-- and timestamp to audit_log for every mutation of a core table. Security
-- definer because the writing user has no INSERT policy on audit_log --
-- audit_log's own RLS should never depend on who happens to trigger it.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_row_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row_id := (v_old ->> 'id')::uuid;
    -- `tenants` has no tenant_id column of its own -- it IS the tenant.
    v_tenant_id := coalesce((v_old ->> 'tenant_id')::uuid, (v_old ->> 'id')::uuid);
  else
    v_new := to_jsonb(new);
    v_row_id := (v_new ->> 'id')::uuid;
    v_tenant_id := coalesce((v_new ->> 'tenant_id')::uuid, (v_new ->> 'id')::uuid);
    if tg_op = 'UPDATE' then
      v_old := to_jsonb(old);
    end if;
  end if;

  insert into public.audit_log (tenant_id, table_name, row_id, action, old_data, new_data, actor_id)
  values (v_tenant_id, tg_table_name, v_row_id, lower(tg_op), v_old, v_new, auth.uid());

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants', 'academic_sessions',
    'people', 'guardians', 'staff', 'students', 'guardian_student',
    'class_levels', 'sections', 'enrolments',
    'roles', 'role_permissions', 'invitations', 'user_profiles',
    'settings'
  ]
  loop
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row_change()',
      t
    );
  end loop;
end;
$$;
