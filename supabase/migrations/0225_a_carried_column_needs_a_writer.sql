-- 0225 -- The carried column needs a writer.
--
-- `0224` gave `invitations` the composite-key device's sixth use, and the
-- probe that was meant to demonstrate it refused a **correct** insert:
--
--   insert into invitations (tenant_id, email, role_id, guardian_id)
--     values (..., <the Parent role>, <a guardian>)
--   -> 23514  invitations_subject_present
--
-- The constraint was right and the design was incomplete. `role_subject`
-- defaults to `'none'`, so an insert that does not mention it says *this role
-- stands for nobody* about a role that stands for a guardian. The CHECK then
-- correctly refuses a row that names one.
--
-- > **A carried column is a copy, and a copy needs somebody to write it.** In
-- > the device's five earlier uses the child carries either a constant the
-- > writer already knows (`slot_schedulable` is always `true`) or a value it is
-- > holding anyway (`marks.max_marks`). This one is neither: it is a fact about
-- > the *parent row*, and the writer would have to look it up.
--
-- Making every caller look it up is a second copy of the rule in every writer,
-- which is what the device exists to avoid — and **a plain insert through
-- PostgREST routes around any function** (`0205`), so it cannot live in a write
-- function either. So it is a `BEFORE INSERT OR UPDATE` trigger, and the split
-- of responsibility is the point:
--
--   * the trigger **populates** the copy, so no caller has to know it exists;
--   * the foreign key and the CHECK **enforce** it, so a trigger dropped by a
--     later migration would make writes fail rather than let a wrong value
--     through.
--
-- That ordering is what keeps this consistent with rule 4 rather than an
-- exception to it: the trigger is convenience, the constraints are the boundary.
--
-- It also buys a readable refusal for the cross-tenant case `0224` closed. The
-- composite key answers a role belonging to another college with a foreign-key
-- error naming three columns; the trigger gets there first and says what
-- happened.

begin;

create or replace function public.invitation_carry_role_subject()
returns trigger
language plpgsql
set search_path = 'public', 'extensions'
as $$
begin
  select r.subject into new.role_subject
  from public.roles r
  where r.id = new.role_id and r.tenant_id = new.tenant_id;

  if new.role_subject is null then
    -- Either the role does not exist, or it belongs to another college, or the
    -- caller cannot read it. All three are the same answer to the person
    -- inviting, and distinguishing them would be a way of asking which roles
    -- another college has.
    raise exception 'That role does not belong to this school.';
  end if;

  return new;
end;
$$;

comment on function public.invitation_carry_role_subject() is
  'Fills invitations.role_subject from the role, so no caller has to know the '
  'carried column exists. It populates; the composite key and '
  'invitations_subject_present enforce.';

drop trigger if exists invitations_carry_role_subject on public.invitations;
create trigger invitations_carry_role_subject
  before insert or update on public.invitations
  for each row execute function public.invitation_carry_role_subject();

commit;
