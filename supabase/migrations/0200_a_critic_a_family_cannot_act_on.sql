-- 0200  A critic a family cannot act on
-- ============================================================================
--
-- Migration `0189` established the rule for gating a critic, and the sentence
-- it wrote down is not about visibility:
--
--   > A critic of this shape is gated on the permission a school gives to
--   > somebody who may *act* on it.
--
-- `fees.billing` was left on `fees.view`, and `fees.view` is one of the ten
-- permissions this product gives a **parent**. Probed as a guardian of a child
-- in Grade 2 A: of the nine checks in the catalogue, eight are withheld and one
-- runs -- this one. So `/checks` rendered a family eight refusals and one
-- finding about the school's own fee-head configuration, linking to
-- `/fees/setup`, which is `roles: ["admin", "accountant"]` and which they
-- cannot open.
--
-- `fees_billing_conflicts` names a fee head billed from two sources at once
-- (rule 6: it charges a family twice and it looks plausible). Deciding which of
-- the two charges is real is a bursar's judgement -- the migration that
-- introduced it says exactly that, and says it is why the function reports in
-- sentences instead of deleting a school's fee structure. A family cannot make
-- that decision, so under 0189's rule they should not be asked to look at it.
--
-- `fees.collect` is held by the administrator and the accountant, which are the
-- roles `/fees/setup` is already open to. One row changes; the function, the
-- runner and the page are untouched.

update reference.checks
   set required_permission = 'fees.collect'
 where key = 'fees.billing';

-- The menu is corrected in the same change (`nav-config.ts`), because rule 4's
-- sentence -- *"the menu and the boundary must not disagree, and only one of
-- them is load-bearing"* -- is only satisfied when both halves move. This row
-- is the load-bearing half.
