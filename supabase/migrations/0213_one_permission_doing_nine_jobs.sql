-- 0213 — One permission doing nine jobs, and five doing none
--
-- `0212` made the permission matrix editable. That is what turned a tidy-up
-- into a defect: sixty-four checkboxes are now a screen an administrator reads
-- and acts on, and the names on them have to mean what they say.
--
-- Swept `hasPermission("…")` across `src/app/(app)` and joined it to
-- `reference.permissions`. The catalogue and the code had drifted apart in both
-- directions at once.
--
-- ## One permission, twelve sites, nine of them not settings
--
-- `settings.manage` is used **12 times** — nearly three times the next most
-- common gate. Three of those are settings:
--
--   /settings/school            the school's own profile
--   /notifications/channels     which channels send
--   (and /settings/team, which is really about logins)
--
-- The other nine are not:
--
--   /academics                  classes and sections
--   /exams, /exams/[id]         creating an exam, adding papers
--   /promotion  (×3 screens)    the rollover into next year
--   /fees, /fees/setup,
--   /fees/instalments           fee heads, structures, billing periods
--
-- > **A college cannot let its examination officer create an exam without also
-- > handing them the school's address, its fee heads, its notification channels
-- > and its invitations screen.** That is not a policy anybody chose; it is the
-- > gate that was nearest to hand when each screen was written.
--
-- `/academics` is the one that shows it plainly: `/academics/sessions`, one
-- level down in the same module, already gates on `academics.manage`. Two
-- screens, one module, two different answers.
--
-- ## …and five permissions that decide nothing at all
--
-- Grepped every one of the 64 codes across `src/` and `supabase/`. Five appear
-- **only in the migration that seeded them**:
--
--   certificates.issue      certificates.manage     exams.publish
--   schedules.manage        guardians.manage
--
-- Rule 15's UI note, arriving in the authorization layer: *a correct string
-- nobody renders is not a feature.* A college can tick and untick these five
-- and nothing anywhere changes.
--
-- ## What that costs, measured
--
-- The boundary is intact — `certificates` INSERT, `exams` ALL, `schedules` ALL
-- are each `current_role_code() = 'admin'`. So this is rule 4's *"the menu and
-- the boundary must not disagree, and only one of them is load-bearing"*, with
-- the load-bearing half right and the other half wrong, invisibly from an
-- administrator's seat.
--
-- Probed as a teacher, whom the menu offers `/certificates` and who meets an
-- unconditional *Issue a certificate* button:
--
--   preview   succeeded — "This is to certify that Vivaan Verma…"
--   issue     42501 — new row violates row-level security policy
--                     for table "document_sequences"
--
-- After choosing a child, a template, a date and two template fields. The
-- serial counter did not move (2 → 2) and no row was written (1 → 1), so the
-- gapless sequence is unharmed — but that sentence is what a teacher is shown.
--
-- ## What this migration does, and what it deliberately does not
--
-- It adds the three codes the nine screens need and grants them to exactly the
-- roles that hold `settings.manage` today, in every college. **Nobody gains or
-- loses anything on the day this runs** — that is the point of the backfill,
-- and it is what makes the change a naming fix rather than a policy change.
--
-- What it does **not** do: make the policies read the matrix. Every one of them
-- compares `current_role_code() = 'admin'`, so a college that grants
-- `certificates.issue` to its office clerk will still be refused by Postgres.
-- That is a real gap and it is the *next* decision, not this one:
--
-- > **Replacing a load-bearing authorization check is a probe of that function
-- > as several roles, not a tidy-up.** This file already says so about
-- > `role_has_permission`, and the isolation suite that would prove sixty
-- > rewritten policies safe cannot run in this sandbox.
--
-- So today the matrix is narrowed to agree with the boundary, which removes
-- the raw error, and the boundary is left exactly as it is.

begin;

-- ---------------------------------------------------------------------------
-- The three names that were missing
-- ---------------------------------------------------------------------------

-- `module` here is the heading the permission screen groups by, so each of
-- these lands beside the ones it belongs with rather than under Settings.
insert into reference.permissions (code, module, ability, description) values
  ('exams.manage', 'exams', 'manage',
   'Create exams, add papers and components, and set up grading schemes.'),
  ('fees.manage', 'fees', 'manage',
   'Set up fee heads, fee structures and billing periods. Not the same as taking money, which is fees.collect.'),
  ('promotion.manage', 'students', 'manage',
   'Run the rollover into next year: promotion previews, renewals, and applying them.')
on conflict (code) do update set
  module = excluded.module,
  ability = excluded.ability,
  description = excluded.description;

-- ---------------------------------------------------------------------------
-- …granted to exactly whoever holds settings.manage today
-- ---------------------------------------------------------------------------

-- The backfill is what makes this a rename rather than a change of policy. On
-- the morning after this runs, every person can do exactly what they could do
-- the evening before; what is different is that a college can now take
-- `fees.manage` away without also taking away the school's address.
--
-- Deliberately not `where code = 'admin'`: a college may already have granted
-- `settings.manage` to somebody else, and this must not quietly demote them.
insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, p.code, true
from public.role_permissions rp
cross join (values ('exams.manage'), ('fees.manage'), ('promotion.manage')) as p(code)
where rp.permission_code = 'settings.manage'
  and rp.allowed
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- …and to the administrator of every college started from now on
-- ---------------------------------------------------------------------------

-- `platform_start_school` gives its administrator every row of
-- `reference.permissions`, so the three new codes are already included there
-- and no edit is needed. Stated rather than left to be rediscovered:
--
--   insert into public.role_permissions (tenant_id, role_id, permission_code)
--   select v_tenant, v_admin_role, code from reference.permissions;
--
-- The other five roles get explicit lists, and none of them should hold these
-- three — a teacher creating exams is a decision a college makes on the
-- permissions screen, not a default this product ships.

commit;
