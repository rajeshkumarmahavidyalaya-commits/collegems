-- 0308: an SMS in India is a registered template, not free text.
--
-- Indian carriers deliver a commercial or transactional SMS only when it
-- matches a template registered on the TRAI DLT registry, sent under a
-- registered six-character header, by a registered principal entity (PE ID).
-- A message that does not match is dropped by the operator, silently, after
-- the gateway has accepted and charged for it. CLAUDE.md rule 10 named this and
-- said what it would take: "a driver change plus a per-tenant sender ID
-- setting, not a new concept", because WhatsApp's approved templates are the
-- same shape. This is that.
--
-- ## 1. The college's registration is a setting
--
-- `notifications.sms_dlt`: whether this college sends SMS only through
-- registered templates, its PE ID, and its header. Off by default: a college
-- outside India, or one whose gateway does the matching itself, keeps today's
-- behaviour exactly. Not a secret (rule 12: a PE ID and a header are printed on
-- every message the college sends).
--
-- ## 2. A template's DLT ID lives where WhatsApp's name lives
--
-- `notification_templates.provider_template_name` already means "the name the
-- provider knows this template by", and was held to WhatsApp by a CHECK. It now
-- admits SMS too, where it must be the 19-digit DLT content template ID. The
-- template's `body` is then the registered text, with `{{variables}}` where
-- the registry has `{#var#}`.
--
-- ## 3. One trigger decides, for every writer
--
-- Two functions write SMS deliveries: `notify_send_for` and the invitation
-- raiser (0227, 0233), which composes its own short body. Rule 6's sentence
-- applies -- *what else reaches this row?* -- so the rule is a BEFORE INSERT
-- trigger on `notification_deliveries`, not a branch in either writer. For a
-- college that requires DLT, a queued SMS is:
--
--   * **frozen** against the registered template: the body is re-rendered from
--     it with the notification's own payload (so the text matches what was
--     registered, whatever the writer composed), and the template ID, header
--     and PE ID are frozen onto the delivery for the driver;
--   * or **skipped at compose time with a sentence**, like a WhatsApp delivery
--     with no approved template: no registered template for this event, no PE
--     ID or header, or a variable the payload does not fill. A queue that can
--     never drain is worse than an honest skip, because it looks like progress.
--
-- ## 4. A critic
--
-- `sms_dlt_problems()` names the events that would be skipped, before the
-- evening a fee reminder goes to nobody.

begin;

-- ---------------------------------------------------------------- the setting --

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'notifications.sms_dlt',
  'SMS registration (DLT, India)',
  'Indian carriers deliver an SMS only when it matches a template registered on '
  'the DLT registry, sent under your registered header. Switch this on once '
  'your templates are registered, and give each SMS template its DLT template ID '
  'under Notifications. An SMS for an event with no registered template is then '
  'skipped with a reason rather than sent and dropped by the carrier.',
  'Notifications',
  'object',
  '[{"name": "required", "type": "boolean", "label": "Send SMS only through registered templates"},
    {"name": "entity_id", "type": "text", "label": "Principal entity ID (PE ID)"},
    {"name": "header", "type": "text", "label": "Sender header (6 characters)"}]'::jsonb,
  '{"required": false}'::jsonb,
  false,
  'settings.manage',
  120
)
on conflict (key) do nothing;

-- ------------------------------------------------- a DLT ID on an SMS template --

alter table public.notification_templates
  drop constraint notification_templates_provider_channel_chk;

alter table public.notification_templates
  add constraint notification_templates_provider_channel_chk
  check (provider_template_name is null or channel in ('whatsapp', 'sms'));

-- DLT content template IDs are 19 digits. Checked here so a template name
-- pasted into the wrong field is refused on save, not by a carrier in March.
alter table public.notification_templates
  add constraint notification_templates_dlt_id_chk
  check (channel <> 'sms' or provider_template_name is null or provider_template_name ~ '^[0-9]{19}$');

comment on column public.notification_templates.provider_template_name is
  'The name the provider knows this template by: the Meta template name for '
  'WhatsApp, the 19-digit DLT content template ID for SMS (0308). Null on every '
  'other channel.';

-- ---------------------------------------------------------------- the trigger --

create or replace function public.notification_deliveries_sms_dlt()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_rule jsonb;
  v_event text;
  v_payload jsonb;
  v_tpl public.notification_templates;
  v_body text;
  v_missing text;
begin
  if new.channel <> 'sms' or new.status <> 'queued' then
    return new;
  end if;

  v_rule := public.setting_value_for(new.tenant_id, 'notifications.sms_dlt');
  if coalesce((v_rule ->> 'required')::boolean, false) is false then
    return new;
  end if;

  if coalesce(btrim(v_rule ->> 'entity_id'), '') = '' or coalesce(btrim(v_rule ->> 'header'), '') = '' then
    new.status := 'skipped';
    new.last_error := 'This college sends SMS only through DLT-registered templates, and its '
      || 'principal entity ID or sender header is not set. Set both under Settings.';
    return new;
  end if;

  select n.event_key, coalesce(n.payload, '{}'::jsonb) into v_event, v_payload
  from public.notifications n where n.id = new.notification_id;

  select * into v_tpl
  from public.notification_templates t
  where t.tenant_id = new.tenant_id
    and t.event_key = v_event
    and t.channel = 'sms'
    and t.is_active
    and t.provider_template_name is not null
  limit 1;

  if v_tpl.id is null then
    new.status := 'skipped';
    new.last_error := 'No DLT-registered SMS template for this event. Indian carriers deliver '
      || 'only messages that match a registered template, so there is nothing that could be '
      || 'sent. Add the template and its DLT template ID under Notifications.';
    return new;
  end if;

  v_body := public.notify_render(v_tpl.body, v_payload);
  v_missing := substring(v_body from '\{\{[a-z0-9_.]+\}\}');
  if v_missing is not null then
    new.status := 'skipped';
    new.last_error := format(
      'The registered SMS template for this event uses %s, and this message has no value '
      || 'for it. A message that does not match its template is dropped by the carrier.',
      v_missing);
    return new;
  end if;

  new.body := v_body;
  new.provider_template := v_tpl.provider_template_name;
  new.provider_params := jsonb_build_object('dlt', jsonb_build_object(
    'template_id', v_tpl.provider_template_name,
    'entity_id', btrim(v_rule ->> 'entity_id'),
    'header', btrim(v_rule ->> 'header')));
  return new;
end;
$$;

revoke all on function public.notification_deliveries_sms_dlt() from public, anon, authenticated;

create trigger notification_deliveries_sms_dlt
  before insert on public.notification_deliveries
  for each row execute function public.notification_deliveries_sms_dlt();

-- ----------------------------------------------------------------- the critic --

create or replace function public.sms_dlt_problems()
returns table (severity text, message text)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_rule jsonb := public.setting_value('notifications.sms_dlt');
begin
  if coalesce((v_rule ->> 'required')::boolean, false) is false then
    return;
  end if;

  if coalesce(btrim(v_rule ->> 'entity_id'), '') = '' or coalesce(btrim(v_rule ->> 'header'), '') = '' then
    return query select 'error'::text,
      'SMS is set to go only through DLT-registered templates, and the principal entity ID or '
      || 'sender header is missing, so every SMS will be skipped. Set both under Settings.';
  end if;

  -- An event that sends by SMS -- by default, or because a schedule of this
  -- college sends it -- with no registered SMS template.
  return query
  select 'warning'::text,
    format('"%s" is sent by SMS and has no DLT-registered SMS template, so each of those '
      || 'messages will be skipped. Add the template and its DLT template ID under Notifications.',
      nt.name)
  from reference.notification_types nt
  where 'sms' = any (nt.default_channels)
    and not exists (
      select 1 from public.notification_templates t
      where t.event_key = nt.key and t.channel = 'sms'
        and t.is_active and t.provider_template_name is not null)
  order by nt.name;
end;
$$;

revoke all on function public.sms_dlt_problems() from public, anon;
grant execute on function public.sms_dlt_problems() to authenticated;

insert into reference.checks
  (key, label, description, function_name, shape, module, href, required_permission, sort)
values (
  'notifications.sms_dlt',
  'SMS templates are registered',
  'For a college that sends SMS only through DLT-registered templates: whether the '
  'entity ID and header are set, and which SMS events have no registered template '
  'and would be skipped.',
  'sms_dlt_problems',
  'severity_message',
  'Notifications',
  '/notifications/log',
  'settings.manage',
  270
)
on conflict (key) do nothing;

commit;
