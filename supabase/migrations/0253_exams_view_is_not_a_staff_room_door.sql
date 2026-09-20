-- 0253 — `exams.view` is held by 302 families
--
-- `0249` wrote two policies called "staff view exam_seat_plans" and "staff view
-- exam_seat_allocations" and gated both on `exams.view`. Probed as a candidate
-- — a login created in a rolled-back transaction, because this college has two
-- logins and both are administrators:
--
--     candidate, while the plan is a DRAFT     302 seats visible
--     candidate, now PUBLISHED                 302 seats visible
--
-- Both numbers should have been 0 and 1. The matrix says why:
--
--     admin       exams.view ✓    exams.manage ✓    exams.grade ✓
--     teacher     exams.view ✓                      exams.grade ✓
--     parent      exams.view ✓
--     student     exams.view ✓
--     accountant  —
--     librarian   —
--
-- **`exams.view` is what lets a family read their own child's result.** It is
-- correct on `exam_results`, where the policy beside it is row-scoped; it is a
-- disaster on a tenant-wide policy, where it means *every candidate may read
-- the entire college's seating plan, including the draft nobody has agreed
-- yet.* Where every child sits, their roll number and which paper they are
-- writing — handed to all 302 of them and to every guardian.
--
-- This codebase has now made this mistake three times and it has had the same
-- shape each time:
--
-- > **A permission is not a proxy for an audience.** `report_fee_defaulters`
-- > was row-scoped and still not a family's report; `attendance.gaps` was
-- > catalogued on `attendance.view`, which a guardian holds; and here a policy
-- > named after staff was gated on a permission four roles hold. The word in
-- > the policy name is not a predicate.
--
-- And the reason it survived review until a probe: **nobody signs in as a
-- candidate here.** Every claim about that seat was a claim nobody could
-- contradict, which is this file's own rule about the roles a reason forgets.
--
-- ---------------------------------------------------------------------------
-- Why a new code rather than a narrower existing one
--
-- The people who read a seating plan are the examination office and the
-- invigilators. No existing permission means that:
--
--   * `exams.manage` is the office alone, and an invigilator who cannot see
--     the chart cannot take the register in their room;
--   * `exams.grade` means *enter marks*, which is a different act that happens
--     a fortnight later;
--   * `exams.view` is the family's.
--
-- So `exams.seating` is its own row in the catalogue. `0213`'s rule about
-- granting a new code to exactly the roles holding the old one does not apply,
-- because there is no old one — this module has never shipped, so no college
-- has a behaviour to preserve. It goes to the roles that run examinations:
-- whoever holds `exams.grade` today, which is the administrator and the
-- teacher, rather than to `admin` by name.

insert into reference.permissions (code, module, ability, description)
values ('exams.seating', 'exams', 'seating',
        'See the seating plan for an exam: which candidate sits in which room and seat');

insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, 'exams.seating', true
from public.role_permissions rp
where rp.permission_code = 'exams.grade' and rp.allowed
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The two policies, re-gated
-- ---------------------------------------------------------------------------

drop policy "staff view exam_seat_plans" on public.exam_seat_plans;
create policy "staff view exam_seat_plans" on public.exam_seat_plans
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('exams.seating') )
  );

drop policy "staff view exam_seat_allocations" on public.exam_seat_allocations;
create policy "staff view exam_seat_allocations" on public.exam_seat_allocations
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('exams.seating') )
  );

-- The candidate's own policy and the guardian's are unchanged and were always
-- correct — they compare `run_status = 'published'` and the person's own id.
-- They were simply never reached, because the wide policy answered first: RLS
-- policies are OR-ed, so the most permissive one wins and a narrow one beside
-- it protects nothing.
--
-- That is the part worth carrying away. **Adding a correct narrow policy does
-- not fix an over-broad one sitting next to it** — the narrow policy is not a
-- restriction, it is an alternative. There is no arrangement of permissive
-- policies in which one of them limits another.

comment on policy "staff view exam_seat_allocations" on public.exam_seat_allocations is
  'Gated on exams.seating, NOT on exams.view. exams.view is what lets a family '
  'read their own child''s result, and this policy is tenant-wide: the two '
  'together handed every candidate the whole college''s plan. A permission is '
  'not a proxy for an audience.';
