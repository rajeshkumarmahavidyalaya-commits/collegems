-- 0332: A new college's roles say whose login they are.
--
-- Found by the setup wizard's walkthrough (0331): the admission form's
-- "Invite the parent to sign in" answered "this college has no role for a
-- parent login" in Northgate Test Annex. `roles.subject` (0224) says which
-- record a login of that role must name -- a parent's guardian record, a
-- student's own record, a teacher's staff record -- and `college_create`
-- inserts the six roles from a literal list that never mentions it. So every
-- college founded through the product since 0224 has all six at 'none':
--
--   demo college:  parent:guardian, student:student, teacher:staff, ...
--   Annex:         parent:none,     student:none,     teacher:none,  ...
--
-- With 'none', an invitation for a parent names nobody, the login it makes has
-- no guardian_id, and `parents view own children` matches nothing: the family
-- signs in and every answer is empty (rule 5, "a guardian record is not a
-- login"). And the screens that look for "the role standing for a guardian"
-- find none, which is how it showed.
--
-- 0300's rule: a default written as a literal list inside a function is a
-- default nobody updates. So the subject of each shipped role is data,
-- `reference.role_subject_defaults`, applied by a BEFORE INSERT trigger on
-- `roles` to a row that arrives saying 'none'. A college may still change a
-- role's subject afterwards; the trigger only decides what a new row starts as.
--
-- The administrator is deliberately not in the list: a college's founder is an
-- administrator with no staff record, and the "add an administrator" screen
-- invites one by address alone. Requiring a staff record there would refuse
-- both. The demo college's admin:staff came from its seed and is left alone.
--
-- Backfill: the roles of existing colleges still at 'none' for these five
-- codes. Changing a subject is refused while pending invitations contradict it
-- (0224); checked first, there are none for these codes.

begin;

create table reference.role_subject_defaults (
  role_code text primary key,
  subject text not null check (subject in ('staff', 'student', 'guardian', 'none'))
);

comment on table reference.role_subject_defaults is
  'Which record a login of each shipped role stands for, in a new college (0332). Read by the roles BEFORE INSERT trigger; the administrator is absent on purpose.';

revoke all on reference.role_subject_defaults from public, anon, authenticated;
grant select on reference.role_subject_defaults to authenticated;

insert into reference.role_subject_defaults (role_code, subject) values
  ('teacher', 'staff'),
  ('accountant', 'staff'),
  ('librarian', 'staff'),
  ('student', 'student'),
  ('parent', 'guardian');

create or replace function public.roles_default_subject()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if coalesce(new.subject, 'none') = 'none' then
    select d.subject into new.subject
    from reference.role_subject_defaults d
    where d.role_code = new.code;
    new.subject := coalesce(new.subject, 'none');
  end if;
  return new;
end;
$$;

comment on function public.roles_default_subject() is
  'BEFORE INSERT on roles (0332): a shipped role that arrives saying ''none'' takes its subject from reference.role_subject_defaults.';

revoke all on function public.roles_default_subject() from public, anon, authenticated;

create trigger roles_default_subject
  before insert on public.roles
  for each row execute function public.roles_default_subject();

update public.roles r
set subject = d.subject
from reference.role_subject_defaults d
where d.role_code = r.code
  and r.subject = 'none';

commit;
