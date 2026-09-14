-- 0231 -- Inviting a school, one picker at a time.
--
-- `0224` made an invitation able to name a person and `0227` made it arrive.
-- Both work on **one** invitation, and the demo college has 555 guardians of
-- 302 children, none of whom can sign in. An office asked to do that through a
-- search box, 555 times, will not do it -- which makes the family half of this
-- product unreachable in practice however correct each single invitation is.
--
-- Rule 13's third instance after promotion and renewals, and its sentences
-- transfer exactly:
--
--   * **a preview that materialises as rows a person can edit**, because every
--     list of 555 has a handful the rules get wrong -- a mother who shares an
--     address with the school office, a father who has asked not to be
--     e-mailed, a child whose guardian is a sibling already invited;
--   * **apply through the module's own write function, not an INSERT**;
--   * **apply partially and record why**;
--   * **refuse an oversized input rather than truncating it.**
--
-- ## One definition of "make an invitation"
--
-- The single-invitation screen supersedes any earlier pending invitation to the
-- same address before inserting -- *"the same intent, expressed twice, usually
-- because the first mail went astray"* -- and that rule lived in a server
-- action. A bulk apply that inserted rows would be a second implementation of
-- it, and the two would differ the first time either changed.
--
-- `invitation_create` is that definition, and **both callers use it**: the
-- screen and `invitation_apply`. Rule 6's billing sentence, applied a third
-- time.
--
-- ## What this deliberately does not carry
--
-- A decision names a guardian, a student or a member of staff, and which of the
-- three is right depends on the *role's* subject -- one table away, which is
-- where rule 4 says to reach for the composite key.
--
-- It does not, and the reason is that **the boundary already refuses the bad
-- row one layer down**: `invitations_subject_present` (`0224`) will not accept
-- an invitation whose subject does not match its role, so a decision that named
-- the wrong kind fails at apply with that constraint's own sentence and lands
-- in `error` beside the row. Carrying `role_subject` a third time would buy a
-- slightly earlier refusal and a third copy to keep in step.

begin;

-- ---------------------------------------------------------------------------
-- The write function both callers share
-- ---------------------------------------------------------------------------

create or replace function public.invitation_create(
  p_email text,
  p_role_id uuid,
  p_subject_id uuid default null
)
returns public.invitations
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_subject text;
  v_row public.invitations;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if coalesce(btrim(p_email), '') = '' then
    raise exception 'An invitation needs an email address';
  end if;

  select r.subject into v_subject
  from public.roles r where r.id = p_role_id and r.tenant_id = v_tenant_id;

  if v_subject is null then
    raise exception 'That role does not belong to this school.';
  end if;

  -- The same intent expressed twice is not an error worth showing a person:
  -- usually the first mail went astray. Supersede rather than refuse.
  update public.invitations
  set status = 'revoked'
  where tenant_id = v_tenant_id
    and lower(email) = lower(btrim(p_email))
    and status = 'pending';

  insert into public.invitations (tenant_id, email, role_id, staff_id, student_id, guardian_id, invited_by)
  values (
    v_tenant_id,
    btrim(p_email),
    p_role_id,
    case when v_subject = 'staff' then p_subject_id end,
    case when v_subject = 'student' then p_subject_id end,
    case when v_subject = 'guardian' then p_subject_id end,
    auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.invitation_create(text, uuid, uuid) is
  'The one definition of making an invitation: supersede any pending one to the '
  'same address, then insert with the subject in the column its role names. '
  'Called by the single-invitation screen and by invitation_apply, so the two '
  'cannot disagree.';

-- ---------------------------------------------------------------------------
-- The run and its rows
-- ---------------------------------------------------------------------------

create table if not exists public.invitation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role_id uuid not null,
  -- Carried from the role by the trigger `0225` already installed for
  -- `invitations` -- the same function works here unchanged, because it reads
  -- `new.tenant_id`, `new.role_id` and `new.role_subject` and this table has
  -- all three. Two instances of the device, one implementation.
  role_subject text not null default 'none',
  -- Null means the whole school. Frozen onto the run per rule 13: editing a
  -- class later must not change what a run already previewed.
  section_id uuid references public.sections (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'applied', 'discarded')),
  applied_at timestamptz,
  applied_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_runs_tenant_id_key unique (tenant_id, id),
  constraint invitation_runs_applied_chk check ((status = 'applied') = (applied_at is not null)),
  constraint invitation_runs_role_fkey
    foreign key (tenant_id, role_id, role_subject)
    references public.roles (tenant_id, id, subject)
    on update cascade
);

-- Two half-built previews of the same operation disagree, and whichever is
-- applied second silently wins.
create unique index if not exists invitation_runs_one_live
  on public.invitation_runs (tenant_id) where status = 'draft';

create trigger invitation_runs_carry_role_subject
  before insert or update on public.invitation_runs
  for each row execute function public.invitation_carry_role_subject();

create table if not exists public.invitation_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  run_id uuid not null,
  guardian_id uuid references public.guardians (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete cascade,
  -- The name is frozen for the screen; the address is editable, because the
  -- commonest correction on a list like this is a typo in an email.
  full_name text not null,
  email text,
  decision text not null default 'invite' check (decision in ('invite', 'skip')),
  reason text,
  is_override boolean not null default false,
  applied_invitation_id uuid references public.invitations (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_decisions_run_fkey
    foreign key (tenant_id, run_id) references public.invitation_runs (tenant_id, id)
    on delete cascade,
  -- Exactly one subject. Which *kind* is right for this run's role is refused
  -- one layer down by `invitations_subject_present`, and is deliberately not a
  -- third copy of that rule.
  constraint invitation_decisions_one_subject_chk check (
    (guardian_id is not null)::int + (student_id is not null)::int + (staff_id is not null)::int = 1
  ),
  -- An invitation with no address cannot be sent, and a skip with no reason is
  -- a row nobody can argue with -- rule 13's whole point is that a person can.
  constraint invitation_decisions_target_chk check (
    case decision
      when 'invite' then coalesce(btrim(email), '') <> ''
      else length(btrim(coalesce(reason, ''))) >= 3
    end
  ),
  constraint invitation_decisions_one_per_address unique (tenant_id, run_id, email)
);

alter table public.invitation_runs enable row level security;
alter table public.invitation_decisions enable row level security;

create policy "admins manage invitation runs" on public.invitation_runs
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_role_code()) = 'admin');

create policy "admins manage invitation decisions" on public.invitation_decisions
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_role_code()) = 'admin');

create trigger set_updated_at_invitation_runs
  before update on public.invitation_runs
  for each row execute function public.set_updated_at();

create trigger set_updated_at_invitation_decisions
  before update on public.invitation_decisions
  for each row execute function public.set_updated_at();

create trigger audit_invitation_runs
  after insert or update or delete on public.invitation_runs
  for each row execute function public.audit_row_change();

create trigger audit_invitation_decisions
  after insert or update or delete on public.invitation_decisions
  for each row execute function public.audit_row_change();

create index if not exists invitation_decisions_run_idx
  on public.invitation_decisions (tenant_id, run_id, decision);

commit;
