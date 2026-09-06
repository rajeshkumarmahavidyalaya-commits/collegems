-- ---------------------------------------------------------------------------
-- Correcting a comment on `set_my_locale`
-- ---------------------------------------------------------------------------
--
-- Migration 0120's header said `user_profiles` "has no self-update policy",
-- which is true, and then reasoned from it that an administrator would be
-- widened by a column GRANT. That second half was wrong and worth correcting
-- rather than leaving to be inherited by the next person who copies the
-- pattern.
--
-- What is actually on the table is one UPDATE policy, "admins update tenant
-- profiles", which lets an administrator write **any** profile in their own
-- school -- their own included. So:
--
--   * an administrator could already set their own locale directly;
--   * a student, parent, teacher, accountant or librarian matches no UPDATE
--     policy at all, and without this function could not choose a language.
--
-- The function is therefore not the "column grant separates columns, not
-- people" case 0120 claimed. It is the plainer one from rule 4: a table
-- deliberately has no INSERT/UPDATE policy for a role, and the narrow way in is
-- a definer function that does its own check -- the same shape as
-- `homework_submit` and `notify_send`.
--
-- The enforcement is unchanged; only the explanation was wrong. CLAUDE.md warns
-- about exactly this: a comment that is a hope rather than a rule.

comment on function public.set_my_locale(text) is
  'Sets the calling user''s interface language. SECURITY DEFINER because '
  '`user_profiles` has only an administrator UPDATE policy, so the other five '
  'roles have no way to write their own row; null means "follow the school".';
