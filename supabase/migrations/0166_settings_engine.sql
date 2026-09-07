-- ---------------------------------------------------------------------------
-- One reader, one writer, one critic
-- ---------------------------------------------------------------------------
--
-- `setting_value` is the only place a default is applied. Every caller that
-- carried its own `coalesce(..., 2.00)` can now stop, and the next caller has
-- nothing to copy -- which is migration `0101`'s lesson (a list of valid values
-- belongs in one place) applied to a default rather than to a CHECK.
--
-- `SECURITY INVOKER`: `settings` already lets any tenant member read and only
-- an administrator write, which is exactly right, and a definer function would
-- be a second answer to a question the policy answers.

create or replace function public.setting_value(p_key text)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select s.value from public.settings s
      where s.tenant_id = ( select public.current_tenant_id() ) and s.key = p_key),
    (select c.default_value from reference.settings_catalog c where c.key = p_key)
  )
$$;

revoke all on function public.setting_value(text) from public, anon;
grant execute on function public.setting_value(text) to authenticated;

comment on function public.setting_value(text) is
  'The tenant''s value, else the catalogue default. The single place a default '
  'is applied -- do not write `coalesce(setting, <literal>)` anywhere else. '
  'Returns null for a key with no catalogue entry, which is a bug rather than '
  'a default; `settings_problems()` names it.';

-- A convenience for the common shape, so a caller wanting one number out of an
-- object setting does not write two `->>` and a cast at every site.
create or replace function public.setting_number(p_key text, p_field text default null)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select case
    when p_field is null then nullif(public.setting_value(p_key) #>> '{}', '')::numeric
    else nullif(public.setting_value(p_key) ->> p_field, '')::numeric
  end
$$;

revoke all on function public.setting_number(text, text) from public, anon;
grant execute on function public.setting_number(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the screen renders
-- ---------------------------------------------------------------------------
--
-- Every catalogue key with its effective value **and whether that value was
-- ever set**. Those are two facts and one column cannot carry both: a school
-- looking at "Library fine per day: 2.00" needs to know whether somebody chose
-- 2.00 or whether nobody has ever looked at this screen. Same instinct as
-- `attendance_coverage` and `audit_actor_label` -- a value that cannot
-- distinguish "chosen" from "never touched" is a value that misleads.

create or replace function public.settings_effective()
returns table (
  key text,
  label text,
  description text,
  module text,
  value_type text,
  fields jsonb,
  value jsonb,
  default_value jsonb,
  is_set boolean,
  is_required boolean,
  updated_at timestamptz,
  updated_by_label text,
  sort_order integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.key, c.label, c.description, c.module, c.value_type, c.fields,
    coalesce(s.value, c.default_value),
    c.default_value,
    s.id is not null,
    c.is_required,
    s.updated_at,
    public.audit_actor_label(s.updated_by),
    c.sort_order
  from reference.settings_catalog c
  left join public.settings s
    on s.key = c.key and s.tenant_id = ( select public.current_tenant_id() )
  order by c.sort_order, c.key
$$;

revoke all on function public.settings_effective() from public, anon;
grant execute on function public.settings_effective() to authenticated;

-- ---------------------------------------------------------------------------
-- Writing one
-- ---------------------------------------------------------------------------
--
-- Validation against the declared type happens here rather than in a CHECK on
-- `settings.value`, for the same reason `grading_scheme_problems()` is not a
-- constraint: the catalogue is data, so a CHECK could not see it, and a key
-- whose declared shape changes in a later migration must not make the existing
-- row unreadable.
--
-- `SECURITY INVOKER`. The admin-only write policy on `settings` is the gate,
-- and the permission check is the matrix layer beside it.

create or replace function public.setting_set(p_key text, p_value jsonb)
returns public.settings
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_cat reference.settings_catalog%rowtype;
  v_row public.settings;
  v_actual text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_cat from reference.settings_catalog where key = p_key;
  if v_cat.key is null then
    -- Deliberately a refusal rather than a free-form insert. A settings table
    -- anybody can invent keys in is the bag this migration exists to replace.
    raise exception 'There is no setting called "%". Settings are declared in the catalogue, not invented at the keyboard.', p_key;
  end if;

  if not public.current_role_allows(v_cat.permission_code) then
    raise exception 'Your role may not change settings';
  end if;

  v_actual := jsonb_typeof(coalesce(p_value, 'null'::jsonb));

  if v_actual <> 'null' then
    if v_cat.value_type = 'number' and v_actual <> 'number' then
      raise exception '% expects a number, not a %', v_cat.label, v_actual;
    elsif v_cat.value_type = 'boolean' and v_actual <> 'boolean' then
      raise exception '% expects yes or no, not a %', v_cat.label, v_actual;
    elsif v_cat.value_type in ('text', 'email', 'url') and v_actual <> 'string' then
      raise exception '% expects text, not a %', v_cat.label, v_actual;
    elsif v_cat.value_type = 'object' and v_actual <> 'object' then
      raise exception '% expects a group of fields, not a %', v_cat.label, v_actual;
    end if;
  end if;

  insert into public.settings (tenant_id, key, value, updated_by)
  values (v_tenant_id, p_key, coalesce(p_value, 'null'::jsonb), ( select auth.uid() ))
  on conflict (tenant_id, key) do update
    set value = excluded.value,
        updated_at = now(),
        updated_by = excluded.updated_by
  returning * into v_row;

  if v_row.id is null then
    raise exception 'You may not change settings';
  end if;

  return v_row;
end;
$$;

revoke all on function public.setting_set(text, jsonb) from public, anon;
grant execute on function public.setting_set(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------
--
-- `grading_scheme_problems()` in a fifth place. Two kinds of finding, and the
-- second is the one that had been silently true for the whole life of the
-- certificates module:
--
--   * a **required** setting nobody has filled in -- which is why a school
--     could not print its own city on its own leaving certificate;
--   * a key sitting in `public.settings` that **no catalogue row describes** --
--     either a migration added a key and forgot the catalogue, or a key was
--     retired and its rows were left behind. Both are real and they read
--     differently, so they get different sentences.

create or replace function public.settings_problems()
returns table (key text, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  -- Required, and either absent or filled with nothing.
  select
    c.key,
    'warning'::text,
    format(
      '%s is not filled in. It is printed on certificates and other documents, '
      'and anything left blank prints blank.', c.label
    )
  from reference.settings_catalog c
  left join public.settings s
    on s.key = c.key and s.tenant_id = ( select public.current_tenant_id() )
  where c.is_required
    and (
      s.id is null
      or s.value is null
      or jsonb_typeof(s.value) = 'null'
      -- An object whose every field is null is "not filled in", however many
      -- keys it has. This is the state both tenants were in.
      or (
        jsonb_typeof(s.value) = 'object'
        and not exists (
          select 1 from jsonb_each(s.value) f
          where jsonb_typeof(f.value) <> 'null'
            and f.value #>> '{}' <> ''
        )
      )
    )

  union all

  select
    s.key,
    'info'::text,
    format(
      '"%s" is stored but nothing describes it. Either a migration added the '
      'key and forgot the catalogue, or the setting was retired and its rows '
      'were left behind.', s.key
    )
  from public.settings s
  where s.tenant_id = ( select public.current_tenant_id() )
    and not exists (select 1 from reference.settings_catalog c where c.key = s.key)

  order by 2, 1
$$;

revoke all on function public.settings_problems() from public, anon;
grant execute on function public.settings_problems() to authenticated;

comment on function public.settings_problems() is
  'Sentences, not a constraint -- a half-configured school must still work. '
  'See migration 0166.';
