-- 0330: Registration settings, as the setup wizard's sixth step asks for them.
--
-- The reference's wizard has a Registration Settings step: a success message
-- for the online form, and which student fields are required. This product
-- had the online form (0268) and its switch, hourly limit and note; it had no
-- success message and no way to say which fields an admission must carry.
-- Both are added here with their executable half, because a setting nobody
-- reads is a column recording an intention (0220):
--
-- 1. `admissions.online` gains `success_message`. `admission_form` returns
--    it, and the public form shows it once an application is accepted. Null
--    keeps today's sentence, so a college that writes nothing sees no change.
--
-- 2. `admissions.required_fields` is new: one switch per optional field of the
--    admission form. The admission screen marks those fields required and the
--    server action refuses an admission without them -- the client is a
--    convenience, the action is the gate. Every switch defaults to off, which
--    is exactly today's form: a missing key means the conservative reading
--    (rule 12), and here conservative is "do not refuse an admission nobody
--    asked us to refuse".

begin;

update reference.settings_catalog
set fields = fields || '[{"name": "success_message", "type": "text", "label": "Message shown after applying"}]'::jsonb,
    default_value = default_value || '{"success_message": null}'::jsonb
where key = 'admissions.online'
  and not exists (select 1 from jsonb_array_elements(fields) f where f ->> 'name' = 'success_message');

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'admissions.required_fields',
  'Fields an admission must have',
  'Which of the admission form''s optional fields the office must fill in before a '
  'student can be admitted. The class, section and kind of student are always required.',
  'Front office',
  'object',
  '[{"name": "date_of_birth", "type": "boolean", "label": "Date of birth"},
    {"name": "gender", "type": "boolean", "label": "Gender"},
    {"name": "blood_group", "type": "boolean", "label": "Blood group"},
    {"name": "phone", "type": "boolean", "label": "Phone number"},
    {"name": "email", "type": "boolean", "label": "Email"},
    {"name": "address_line1", "type": "boolean", "label": "Full address"},
    {"name": "city", "type": "boolean", "label": "City"},
    {"name": "state", "type": "boolean", "label": "State"},
    {"name": "postal_code", "type": "boolean", "label": "PIN code"},
    {"name": "roll_number", "type": "boolean", "label": "Roll number"},
    {"name": "medium", "type": "boolean", "label": "Medium"},
    {"name": "house", "type": "boolean", "label": "House"}]'::jsonb,
  '{"date_of_birth": false, "gender": false, "blood_group": false, "phone": false, "email": false,
    "address_line1": false, "city": false, "state": false, "postal_code": false,
    "roll_number": false, "medium": false, "house": false}'::jsonb,
  false,
  'students.manage',
  105
)
on conflict (key) do nothing;

create or replace function public.admission_form(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_setting jsonb;
  v_session_id uuid;
begin
  select * into v_tenant from public.tenants t
  where t.slug = lower(btrim(coalesce(p_slug, '')));
  if v_tenant.id is null or not v_tenant.is_active then
    return null;
  end if;

  v_setting := public.setting_value_for(v_tenant.id, 'admissions.online');
  if not coalesce((v_setting ->> 'enabled')::boolean, false) then
    return null;
  end if;

  v_session_id := public.current_session_id(v_tenant.id);
  if v_session_id is null then
    return null;
  end if;

  -- The projection is the whole of what an anonymous caller learns about a
  -- college: its name, its year's name, its class levels and its own two
  -- sentences. No count, no staff, no address it did not choose to write.
  return jsonb_build_object(
    'college', v_tenant.name,
    'slug', v_tenant.slug,
    'session', (select s.name from public.academic_sessions s where s.id = v_session_id),
    'note', nullif(btrim(coalesce(v_setting ->> 'note', '')), ''),
    'success_message', nullif(btrim(coalesce(v_setting ->> 'success_message', '')), ''),
    'class_levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name)
                       order by cl.sequence, cl.name, cl.id)
      from public.class_levels cl
      where cl.tenant_id = v_tenant.id
    ), '[]'::jsonb)
  );
end;
$$;

commit;
