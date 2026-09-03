-- Phase 3.2 -- two codes the exams module did not need until it had a card.
--
-- `exams.view` already covers reading marks, and a family's access to their own
-- card is RLS, not the matrix. These two draw lines RLS cannot:
--
--   exams.remark   writing the class teacher's sentence. RLS restricts it to
--                  the class teacher of the section -- but a school that does
--                  not want remarks at all turns them off here, for everybody,
--                  without editing a policy.
--   exams.publish  freezing results. `exams_publish` already refuses anybody
--                  who is not an admin; this is what lets the button say so
--                  before it is pressed, and what a school with a second
--                  administrator who may not publish would untick.

insert into reference.permissions (code, module, ability, description) values
  ('exams.remark', 'exams', 'remark',
   'Write the class teacher''s remark on a report card'),
  ('exams.publish', 'exams', 'publish',
   'Publish results, freezing marks, rank and attendance onto the card')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'exams.remark'
from public.roles r
where r.code in ('admin', 'teacher')
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'exams.publish'
from public.roles r
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;
