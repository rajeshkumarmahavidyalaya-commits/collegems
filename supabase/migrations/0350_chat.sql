-- 0350: Chat, the reference's SM Chat.
--
-- Staff start a conversation with one or more students, or a named group, and
-- a student or a parent messages one of their child's teachers ("Message a
-- Teacher"). Three tables: a conversation, its members (logins), and its
-- messages.
--
-- Who may talk to whom is the whole design, and it is decided in Postgres:
--
--   * **A teacher reaches the children they teach**: those enrolled this year in
--     a class the teacher is class teacher of, or teaches a subject to. An
--     administrator reaches every child. Nobody else starts a staff chat.
--   * **A family reaches its child's teachers**, by the same relation turned
--     round. A student or a parent cannot message an arbitrary member of staff,
--     and cannot message another family at all.
--   * **A member is a login.** A child with no login cannot be added; the
--     answer counts them rather than adding nobody silently.
--
-- Every write is a narrow definer (`chat_start`, `chat_start_with_teacher`,
-- `chat_send`, `chat_mark_read`) and no table has a write policy: a policy
-- could check membership but not who may start a conversation with whom.
-- Reads are policies over membership, through `chat_is_member`, a definer:
-- a policy on `chat_members` that queried `chat_members` would recurse.
--
-- Messages are append-only by revoke (rule 6's stronger shape): nobody edits
-- or removes what they said. Audited anyway, as a money row is (0216): the log
-- records the insert.

begin;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  kind text not null check (kind in ('direct', 'group')),
  name text check (name is null or length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users (id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint chat_conversations_group_name_chk check (kind = 'direct' or name is not null)
);
create index chat_conversations_tenant_last_idx on public.chat_conversations (tenant_id, last_message_at desc);
create index chat_conversations_created_by_idx on public.chat_conversations (created_by);

create table public.chat_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  conversation_id uuid not null,
  user_id uuid not null references auth.users (id),
  side text not null check (side in ('staff', 'family')),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, user_id),
  constraint chat_members_conversation_fkey foreign key (tenant_id, conversation_id)
    references public.chat_conversations (tenant_id, id) on delete cascade
);
create index chat_members_user_idx on public.chat_members (user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  conversation_id uuid not null,
  sender_id uuid not null references auth.users (id),
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint chat_messages_conversation_fkey foreign key (tenant_id, conversation_id)
    references public.chat_conversations (tenant_id, id) on delete cascade
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc);
create index chat_messages_sender_idx on public.chat_messages (sender_id);

comment on table public.chat_conversations is 'A conversation between staff and a family, direct or a named group (0350).';
comment on table public.chat_members is 'Who is in a conversation: logins, on the staff or the family side, with when they last read it (0350).';
comment on table public.chat_messages is 'What was said, append-only by revoke: nobody edits or removes a message (0350).';

create trigger set_updated_at before update on public.chat_conversations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.chat_members
  for each row execute function public.set_updated_at();
create trigger audit_chat_conversations after insert or update or delete on public.chat_conversations
  for each row execute function public.audit_row_change();
create trigger audit_chat_members after insert or update or delete on public.chat_members
  for each row execute function public.audit_row_change();
create trigger audit_chat_messages after insert or update or delete on public.chat_messages
  for each row execute function public.audit_row_change();

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

-- Append-only: what was said stays said.
revoke update, delete on public.chat_messages from anon, authenticated;

create function public.chat_is_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.chat_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = auth.uid()
      and m.tenant_id = public.current_tenant_id()
  );
$$;

comment on function public.chat_is_member(uuid) is
  'Is the caller in this conversation, in their own college. DEFINER so the chat policies can ask it without a policy on chat_members querying chat_members (0350).';

revoke all on function public.chat_is_member(uuid) from public, anon;
grant execute on function public.chat_is_member(uuid) to authenticated;

create policy "members view their conversations" on public.chat_conversations
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and public.chat_is_member(id));
create policy "members view their conversations' members" on public.chat_members
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and public.chat_is_member(conversation_id));
create policy "members view their conversations' messages" on public.chat_messages
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and public.chat_is_member(conversation_id));
-- No write policy on any of the three, deliberately: the functions below decide
-- who may start a conversation with whom, which no policy can express.

-- ---------------------------------------------------------------------------
-- Who may reach whom

-- The children a member of staff may start a conversation with this year.
create function public.chat_reachable_students(p_tenant uuid, p_user uuid)
returns table (student_id uuid)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with me as (
    select up.staff_id, r.code
    from public.user_profiles up
    join public.roles r on r.id = up.role_id
    where up.id = p_user and up.tenant_id = p_tenant
  ),
  session as (
    select s.id from public.academic_sessions s where s.tenant_id = p_tenant and s.is_current
  )
  select distinct e.student_id
  from public.enrolments e
  join public.sections sec on sec.id = e.section_id and sec.tenant_id = p_tenant
  cross join me
  where e.tenant_id = p_tenant
    and e.session_id = (select id from session)
    and e.status = 'active'
    and (
      me.code = 'admin'
      or (me.staff_id is not null and (
        sec.class_teacher_staff_id = me.staff_id
        or exists (
          select 1 from public.section_subjects ss
          where ss.tenant_id = p_tenant and ss.section_id = sec.id
            and ss.session_id = e.session_id and ss.teacher_staff_id = me.staff_id
        )
      ))
    );
$$;

comment on function public.chat_reachable_students(uuid, uuid) is
  'The children a member of staff may start a chat with this year: every one for an administrator, the classes they are class teacher of or teach a subject to for a teacher (0350). Used inside the chat definers only.';

revoke all on function public.chat_reachable_students(uuid, uuid) from public, anon, authenticated;

-- The teachers a family may message: the same relation, turned round.
create function public.chat_my_teachers()
returns table (staff_id uuid, full_name text, designation text, subjects text, has_login boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  select s.id into v_session from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current;
  return query
  with kids as (
    select up.student_id as student_id from public.user_profiles up
    where up.id = auth.uid() and up.tenant_id = v_tenant and up.student_id is not null
    union
    select gs.student_id from public.guardian_student gs
    join public.user_profiles up on up.guardian_id = gs.guardian_id
    where up.id = auth.uid() and up.tenant_id = v_tenant and gs.tenant_id = v_tenant
  ),
  sections as (
    select distinct e.section_id from public.enrolments e
    where e.tenant_id = v_tenant and e.session_id = v_session and e.status = 'active'
      and e.student_id in (select student_id from kids)
  ),
  teaching as (
    select sec.class_teacher_staff_id as staff_id, 'Class teacher'::text as what
    from public.sections sec where sec.id in (select section_id from sections) and sec.class_teacher_staff_id is not null
    union
    select ss.teacher_staff_id, sub.name
    from public.section_subjects ss
    join public.subjects sub on sub.id = ss.subject_id
    where ss.tenant_id = v_tenant and ss.session_id = v_session
      and ss.section_id in (select section_id from sections) and ss.teacher_staff_id is not null
  )
  select st.id,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         st.designation,
         string_agg(distinct t.what, ', ' order by t.what),
         exists (select 1 from public.user_profiles up2 where up2.staff_id = st.id and up2.tenant_id = v_tenant)
  from teaching t
  join public.staff st on st.id = t.staff_id and st.tenant_id = v_tenant and st.status = 'active'
  join public.people p on p.id = st.person_id
  group by st.id, p.first_name, p.last_name, st.designation
  order by 2, 1;
end;
$$;

comment on function public.chat_my_teachers() is
  'The teachers of the caller''s own children this year (class teacher, subject teachers), with whether each has a login to message. DEFINER: a family cannot read staff or people; projects a name and a designation (0350).';

revoke all on function public.chat_my_teachers() from public, anon;
grant execute on function public.chat_my_teachers() to authenticated;

-- ---------------------------------------------------------------------------
-- Starting a conversation

create function public.chat_start(p_name text, p_student_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_wanted int;
  v_reachable int;
  v_logins uuid[];
  v_without int;
  v_id uuid;
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if public.current_role_code() not in ('admin', 'teacher') then
    raise exception 'A teacher or an administrator starts a chat with students.' using errcode = '42501';
  end if;
  select count(distinct s) into v_wanted from unnest(p_student_ids) s where s is not null;
  if v_wanted = 0 then
    raise exception 'Choose at least one student.' using errcode = '22023';
  end if;
  if v_wanted > 200 then
    raise exception 'A chat has at most 200 students.' using errcode = '22023';
  end if;
  if v_wanted > 1 and v_name is null then
    raise exception 'Give a chat with several students a name.' using errcode = '22023';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'A chat''s name is at most 120 characters.' using errcode = '22023';
  end if;

  select count(*) into v_reachable
  from (select distinct s from unnest(p_student_ids) s where s is not null) w
  where w.s in (select r.student_id from public.chat_reachable_students(v_tenant, auth.uid()) r);
  if v_reachable <> v_wanted then
    raise exception 'You can chat only with the students you teach this year.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct up.id), '{}') into v_logins
  from public.user_profiles up
  where up.tenant_id = v_tenant and up.student_id = any (p_student_ids);
  v_without := v_wanted - (
    select count(distinct up.student_id) from public.user_profiles up
    where up.tenant_id = v_tenant and up.student_id = any (p_student_ids)
  );
  if cardinality(v_logins) = 0 then
    raise exception 'None of these students has a login yet, so there is nobody to chat with. Invite them on Settings, Team first.'
      using errcode = '22023';
  end if;

  -- A direct chat with one student is found again rather than doubled.
  if v_name is null then
    select c.id into v_id
    from public.chat_conversations c
    where c.tenant_id = v_tenant and c.kind = 'direct'
      and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = auth.uid())
      and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = v_logins[1])
      and (select count(*) from public.chat_members m where m.conversation_id = c.id) = 2
    limit 1;
    if v_id is not null then
      return jsonb_build_object('conversation_id', v_id, 'added', 1, 'without_login', 0, 'existing', true);
    end if;
  end if;

  insert into public.chat_conversations (tenant_id, kind, name, created_by)
  values (v_tenant, case when v_name is null then 'direct' else 'group' end, v_name, auth.uid())
  returning id into v_id;
  insert into public.chat_members (tenant_id, conversation_id, user_id, side, last_read_at)
  values (v_tenant, v_id, auth.uid(), 'staff', now());
  insert into public.chat_members (tenant_id, conversation_id, user_id, side)
  select v_tenant, v_id, l, 'family' from unnest(v_logins) l where l <> auth.uid()
  on conflict (conversation_id, user_id) do nothing;

  return jsonb_build_object('conversation_id', v_id, 'added', cardinality(v_logins), 'without_login', v_without, 'existing', false);
end;
$$;

comment on function public.chat_start(text, uuid[]) is
  'A teacher or administrator starts a chat with students they teach this year: direct with one (found again if it exists), or a named group. Students with no login are counted, not added. DEFINER: no table has a write policy, on purpose (0350).';

create function public.chat_start_with_teacher(p_staff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_teacher_login uuid;
  v_id uuid;
  v_name text;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not exists (select 1 from public.chat_my_teachers() t where t.staff_id = p_staff_id) then
    raise exception 'You can message the teachers of your own child only.' using errcode = '42501';
  end if;
  select up.id into v_teacher_login from public.user_profiles up
  where up.staff_id = p_staff_id and up.tenant_id = v_tenant
  limit 1;
  if v_teacher_login is null then
    raise exception 'That teacher has no login yet, so a message would reach nobody. Ask the college office.' using errcode = '22023';
  end if;

  select c.id into v_id
  from public.chat_conversations c
  where c.tenant_id = v_tenant and c.kind = 'direct'
    and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = auth.uid())
    and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.user_id = v_teacher_login)
    and (select count(*) from public.chat_members m where m.conversation_id = c.id) = 2
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.chat_conversations (tenant_id, kind, created_by)
  values (v_tenant, 'direct', auth.uid())
  returning id into v_id;
  insert into public.chat_members (tenant_id, conversation_id, user_id, side, last_read_at)
  values (v_tenant, v_id, auth.uid(), 'family', now()),
         (v_tenant, v_id, v_teacher_login, 'staff', null);
  return v_id;
end;
$$;

comment on function public.chat_start_with_teacher(uuid) is
  'A student or a parent opens (or finds again) a direct chat with one of their child''s teachers this year. DEFINER, checked against chat_my_teachers (0350).';

-- ---------------------------------------------------------------------------
-- Talking

create function public.chat_send(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.chat_is_member(p_conversation_id) then
    raise exception 'You are not in that conversation.' using errcode = '42501';
  end if;
  if length(v_body) not between 1 and 4000 then
    raise exception 'A message is 1 to 4,000 characters.' using errcode = '22023';
  end if;
  insert into public.chat_messages (tenant_id, conversation_id, sender_id, body)
  values (v_tenant, p_conversation_id, auth.uid(), v_body)
  returning id into v_id;
  update public.chat_conversations set last_message_at = now()
  where id = p_conversation_id and tenant_id = v_tenant;
  update public.chat_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid() and tenant_id = v_tenant;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The message was not sent.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

comment on function public.chat_send(uuid, text) is
  'A member says something in a conversation. DEFINER: messages have no insert policy and the conversation''s last-message time is not the sender''s to write (0350).';

create function public.chat_mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.chat_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid()
    and tenant_id = public.current_tenant_id();
end;
$$;

comment on function public.chat_mark_read(uuid) is
  'The caller has read a conversation up to now. Their own member row only (0350).';

-- The name a member shows in a chat: their own record's name, whoever reads it.
create function public.chat_display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    'A member of the college'
  )
  from public.user_profiles up
  left join public.staff st on st.id = up.staff_id
  left join public.students stu on stu.id = up.student_id
  left join public.guardians g on g.id = up.guardian_id
  left join public.people p on p.id = coalesce(st.person_id, stu.person_id, g.person_id)
  where up.id = p_user and up.tenant_id = public.current_tenant_id();
$$;

-- One row per conversation the caller is in: the name to show, the last
-- message, and how many arrived since they last read.
create function public.chat_my_conversations()
returns table (
  conversation_id uuid,
  kind text,
  title text,
  last_message text,
  last_message_at timestamptz,
  unread integer,
  members integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with mine as (
    select m.conversation_id, m.last_read_at
    from public.chat_members m
    where m.user_id = auth.uid() and m.tenant_id = public.current_tenant_id()
  )
  select c.id,
         c.kind,
         coalesce(
           c.name,
           (select public.chat_display_name(o.user_id)
              from public.chat_members o
             where o.conversation_id = c.id and o.user_id <> auth.uid()
             order by o.created_at limit 1),
           'Conversation'
         ),
         (select msg.body from public.chat_messages msg where msg.conversation_id = c.id order by msg.created_at desc, msg.id desc limit 1),
         c.last_message_at,
         (select count(*)::integer from public.chat_messages msg
            where msg.conversation_id = c.id and msg.sender_id <> auth.uid()
              and (mine.last_read_at is null or msg.created_at > mine.last_read_at)),
         (select count(*)::integer from public.chat_members o where o.conversation_id = c.id)
  from mine
  join public.chat_conversations c on c.id = mine.conversation_id
  order by coalesce(c.last_message_at, c.created_at) desc, c.id
  limit 200;
$$;

comment on function public.chat_display_name(uuid) is
  'The name a login shows in a chat, in the caller''s own college. Called only inside the chat read models, which ask it about co-members; not executable by any JWT role (0350).';
comment on function public.chat_my_conversations() is
  'The caller''s conversations, newest first, each with the name to show, the last message and how many are unread. DEFINER filtered by the caller''s own membership and college; at most 200 (0350).';

-- Who is in one conversation, with names: for the thread's header and to
-- name each message's sender.
create function public.chat_members_of(p_conversation_id uuid)
returns table (user_id uuid, display_name text, side text, is_me boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.chat_is_member(p_conversation_id) then
    raise exception 'You are not in that conversation.' using errcode = '42501';
  end if;
  return query
  select m.user_id, public.chat_display_name(m.user_id), m.side, m.user_id = auth.uid()
  from public.chat_members m
  where m.conversation_id = p_conversation_id and m.tenant_id = public.current_tenant_id()
  order by m.side desc, 2;
end;
$$;

comment on function public.chat_members_of(uuid) is
  'The members of a conversation the caller is in, with the names they show. Refuses anybody else in a sentence (0350).';

revoke all on function public.chat_start(text, uuid[]) from public, anon;
revoke all on function public.chat_start_with_teacher(uuid) from public, anon;
revoke all on function public.chat_send(uuid, text) from public, anon;
revoke all on function public.chat_mark_read(uuid) from public, anon;
revoke all on function public.chat_my_conversations() from public, anon;
revoke all on function public.chat_display_name(uuid) from public, anon, authenticated;
revoke all on function public.chat_members_of(uuid) from public, anon;
grant execute on function public.chat_start(text, uuid[]) to authenticated;
grant execute on function public.chat_start_with_teacher(uuid) to authenticated;
grant execute on function public.chat_send(uuid, text) to authenticated;
grant execute on function public.chat_mark_read(uuid) to authenticated;
grant execute on function public.chat_my_conversations() to authenticated;
grant execute on function public.chat_members_of(uuid) to authenticated;

commit;
