-- 0363: the admit card page names the exams it serves.
--
-- 0361's admit card lookup takes an exam, and the only list of public exams
-- was public_exam_timetable, which answers only while the timetable page is
-- on. A college that opens admit cards and not the timetable would show a
-- form with nothing to choose. public_college now lists the public exams'
-- names (and nothing else about them) while admit cards are on.

begin;

create or replace function public.public_college(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_pages jsonb;
  v_apply boolean;
  v_admit boolean;
begin
  select * into v_tenant from public.tenants t
  where t.slug = lower(btrim(coalesce(p_slug, ''))) and t.is_active;
  if v_tenant.id is null then
    return null;
  end if;
  v_pages := public.setting_value_for(v_tenant.id, 'public.pages');
  v_apply := coalesce((public.setting_value_for(v_tenant.id, 'admissions.online') ->> 'enabled')::boolean, false);
  v_admit := coalesce((v_pages ->> 'admit_cards')::boolean, false);
  if not (v_apply or v_admit
          or coalesce((v_pages ->> 'enquiry')::boolean, false)
          or coalesce((v_pages ->> 'staff_application')::boolean, false)
          or coalesce((v_pages ->> 'certificate_check')::boolean, false)
          or coalesce((v_pages ->> 'exam_timetable')::boolean, false)
          or coalesce((v_pages ->> 'results')::boolean, false)) then
    return null;
  end if;
  return jsonb_build_object(
    'college', v_tenant.name,
    'slug', v_tenant.slug,
    'session', (select s.name from public.academic_sessions s
                where s.tenant_id = v_tenant.id and s.is_current limit 1),
    'note', nullif(btrim(coalesce(v_pages ->> 'note', '')), ''),
    'pages', jsonb_build_object(
      'apply', v_apply,
      'enquiry', coalesce((v_pages ->> 'enquiry')::boolean, false),
      'staff_application', coalesce((v_pages ->> 'staff_application')::boolean, false),
      'certificate_check', coalesce((v_pages ->> 'certificate_check')::boolean, false),
      'exam_timetable', coalesce((v_pages ->> 'exam_timetable')::boolean, false),
      'admit_cards', v_admit,
      'results', coalesce((v_pages ->> 'results')::boolean, false)
    ),
    'class_levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name) order by cl.sequence, cl.name, cl.id)
      from public.class_levels cl where cl.tenant_id = v_tenant.id
    ), '[]'::jsonb),
    'admit_exams', case when v_admit then coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by e.starts_on nulls last, e.name, e.id)
      from public.exams e
      where e.tenant_id = v_tenant.id and e.public_timetable
        and e.session_id = (select s.id from public.academic_sessions s where s.tenant_id = v_tenant.id and s.is_current)
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

commit;
