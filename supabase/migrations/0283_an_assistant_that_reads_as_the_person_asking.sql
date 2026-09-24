-- 0283: an assistant that answers from the data, as the person asking; and
-- creating an elective group in one statement.
--
-- 1. subject_group_create
--
-- An elective group is two writes (the group, then the subjects allotted to
-- it), and supabase-js cannot open a transaction, so a group whose options
-- failed would be left offering nothing. One INVOKER function: the policies on
-- both tables (administrator only) stay the boundary.
--
-- 2. The assistant
--
-- A chat that answers "who owes fees in Grade 6?" or "how many were absent
-- today?" in words, with the table and a download. The design decision that
-- matters is **whose authority it answers with**:
--
-- > The assistant has no access of its own. Every question is answered by the
-- > Edge Function calling this database *with the asker's own token*, through
-- > the same read paths the screens use -- `report_list`/`report_run`,
-- > `dashboard_summary`, `global_search`, `mobile_student`, `checks_run`,
-- > `subject_choices_for_student`. So the super admin's assistant sees the
-- > whole college, a teacher's sees what a teacher may, and a student's sees
-- > their own record, **because RLS and the permission matrix say so, not
-- > because the assistant was told to behave.**
--
-- That is also what makes it safe against a prompt that tries to talk it into
-- more: there is nothing more for it to reach. Every tool is a read, and every
-- read is the caller's.
--
-- Two things this migration adds for it:
--
-- - `assistant_messages`, one row per question: who asked, what, and which
--   tools answered. Append-only by revoke (rule 6's stronger shape). The asker
--   reads their own; the administrator reads the college's, because a tool
--   that can read every fee account should leave a trail of what it was asked.
--   Audited like everything else (rule 9).
-- - `assistant_quota()`: how many questions the caller has left today. Each
--   question costs the platform money at the model provider, so a person gets
--   a bounded number a day (rule 7: bound it and say the bound).
--
-- 3. The provider key
--
-- The model provider's key lives in Supabase Vault, not in this repository and
-- not in the Next.js app (rule 6: "secrets never enter the Next.js app").
-- `assistant_provider_key()` is the one way to read it: SECURITY DEFINER,
-- revoked from `public`, `anon` and `authenticated`, granted to `service_role`
-- only -- which the Edge Function holds and no browser ever does. The key itself
-- is written to Vault outside any migration, so it is never committed.

create or replace function public.subject_group_create(
  p_class_level_id uuid,
  p_name text,
  p_min integer,
  p_max integer,
  p_subject_ids uuid[],
  p_closes_on date default null
)
returns uuid
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid := public.current_session_id(v_tenant);
  v_group uuid;
  v_ids uuid[] := coalesce(array(select distinct x from unnest(p_subject_ids) x where x is not null), '{}');
  v_n integer;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college first.' using errcode = '42501';
  end if;
  -- Mirrors "admins manage subject_groups", for the sentence: a refused
  -- INSERT raises a policy error, which is not one (0257).
  if (select public.current_role_code()) <> 'admin' then
    raise exception 'Only the super admin can set up elective choices.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Give the choice a name, such as "Language electives".';
  end if;
  if cardinality(v_ids) < 2 then
    raise exception 'Allot at least two subjects: a choice of one is not a choice.';
  end if;
  if p_min < 0 or p_max < 1 or p_min > p_max then
    raise exception 'Students must choose between % and % subjects, which is not a range.', p_min, p_max;
  end if;
  if p_max > cardinality(v_ids) then
    raise exception 'Students cannot choose % subjects from %.', p_max, cardinality(v_ids);
  end if;

  insert into public.subject_groups (tenant_id, session_id, class_level_id, name, min_choices, max_choices, closes_on)
  values (v_tenant, v_session, p_class_level_id, trim(p_name), p_min, p_max, p_closes_on)
  returning id into v_group;

  insert into public.subject_group_options (tenant_id, group_id, subject_id)
  select v_tenant, v_group, x from unnest(v_ids) x;
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_ids) then
    raise exception 'Expected to allot % subjects and allotted %. Nothing was saved.', cardinality(v_ids), v_n;
  end if;

  return v_group;
end;
$function$;

comment on function public.subject_group_create(uuid, text, integer, integer, uuid[], date) is
  'Create an elective group for a class this year with its allotted subjects, in one transaction (0283). Created closed; the office opens it.';

revoke all on function public.subject_group_create(uuid, text, integer, integer, uuid[], date) from public, anon;
grant execute on function public.subject_group_create(uuid, text, integer, integer, uuid[], date) to authenticated;

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question text not null check (length(question) between 1 and 2000),
  tools text[] not null default '{}',
  status text not null default 'answered' check (status in ('answered', 'failed')),
  created_at timestamptz not null default now()
);

create index assistant_messages_user_day_idx on public.assistant_messages (tenant_id, user_id, created_at);

comment on table public.assistant_messages is
  'One row per question asked of the assistant: who, what, and which read paths answered it (0283). Append-only by revoke.';

create trigger audit_assistant_messages after insert or update or delete on public.assistant_messages
  for each row execute function public.audit_row_change();

alter table public.assistant_messages enable row level security;

create policy "members log own assistant questions" on public.assistant_messages
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

create policy "members view own assistant questions" on public.assistant_messages
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

create policy "admins view college assistant questions" on public.assistant_messages
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

-- The record of what was asked is never edited or removed by anybody holding a
-- JWT. A revoke raises; an absent policy would silently touch nothing (rule 6).
revoke update, delete on public.assistant_messages from authenticated, anon;

-- Questions left today for the caller. 150 a day is generous for a person and
-- a hard ceiling on what one login can cost; the day is the college's own.
create or replace function public.assistant_quota()
returns integer
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  select greatest(0, 150 - count(*))::integer
  from public.assistant_messages m
  where m.tenant_id = public.current_tenant_id()
    and m.user_id = auth.uid()
    and m.created_at >= (
      select date_trunc('day', now() at time zone coalesce(t.timezone, 'Asia/Kolkata')) at time zone coalesce(t.timezone, 'Asia/Kolkata')
      from public.tenants t where t.id = public.current_tenant_id()
    );
$function$;

revoke all on function public.assistant_quota() from public, anon;
grant execute on function public.assistant_quota() to authenticated;

-- The model provider's key, for the Edge Function and nobody else.
create or replace function public.assistant_provider_key()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'gemini_api_key' limit 1;
$function$;

comment on function public.assistant_provider_key() is
  'The assistant''s model provider key from Vault (0283). Service role only: revoked from every role holding a JWT.';

revoke all on function public.assistant_provider_key() from public, anon, authenticated;
grant execute on function public.assistant_provider_key() to service_role;
