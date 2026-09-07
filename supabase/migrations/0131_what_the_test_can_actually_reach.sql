-- ---------------------------------------------------------------------------
-- Correcting 0129's last paragraph
-- ---------------------------------------------------------------------------
--
-- Migration 0129 fixed the `withheld` array and then wrote down the lesson:
-- a branch that describes a *restricted* caller has to be probed as one. It
-- ended by claiming that
--
--   > `tests/dashboard/summary.test.ts` now asks for the brief as each of the
--   > six roles
--
-- and it does not, because it cannot. The suite has two logins and both are
-- administrators — that is deliberate, it is what makes the cross-tenant suite
-- possible, and it means the JWT role claim is `admin` in every request the
-- test file can make. Leaving the sentence would have been the same species of
-- mistake it was written about: a comment describing a check that is not there.
--
-- What is actually true, and what the test file says on its own face:
--
--   * The **gating** was probed by running `dashboard_summary()` under each
--     role's claims directly against the database — admin, accountant,
--     librarian and teacher all return the blocks their permissions allow and
--     name the rest. That is how the `22P02` was found in the first place.
--   * The **test file** pins the structural invariant that survives having only
--     one role to sign in as: every block present is one not named in
--     `withheld`, every block named in `withheld` is absent, and nothing is
--     named that the page has no sentence for. Those hold for any role, so they
--     would catch a block added later and gated but never explained.
--   * The **sentence the page builds** from `withheld` is unit-tested for one,
--     several and unknown block names in `tests/dashboard/readings.test.ts`.
--
-- The general form, which is worth more than this correction:
--
--   > A test environment has a shape, and it decides which claims a test file
--   > can make. Write down what was actually checked and how — not what the
--   > ideal check would have been — because the next person reads the comment
--   > and stops looking.
--
-- Nothing executable changes here. The function's own comment is restated so
-- that `\df+` and the migration history agree.

comment on function public.dashboard_summary() is
  'One jsonb brief for the home screen: roll, enrolment by year group, both '
  'registers, money, the latest published exam''s pass rate and the library, in '
  'a single round trip. SECURITY INVOKER, so every figure is the caller''s own '
  'view through RLS, and each block is additionally gated on the permission '
  'matrix -- the blocks a role may not see are named in "withheld" rather than '
  'silently missing, so a screen can say why a card is absent. Role gating is '
  'covered structurally in tests/dashboard/summary.test.ts; the suite signs in '
  'as administrators only, so per-role behaviour is verified by running this '
  'function under each role''s claims rather than by the test file.';
