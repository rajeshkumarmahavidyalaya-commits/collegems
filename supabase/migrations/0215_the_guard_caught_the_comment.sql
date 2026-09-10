-- 0215 — The guard caught the comment, and the comment was wrong
--
-- `0214` created `subscription_invoices` without an audit trigger, under a
-- comment asserting rule 9's exemption:
--
--   > Rule 9's exemption test — "a table is exempt when the row IS the record" —
--   > applies here, so no audit trigger: an append-only row that is never edited
--   > would store a second copy of a fact that cannot change.
--
-- `audit_guard_violations()` disagreed in the same session, by name, which is
-- the entire reason it exists — and checking the precedent it disagreed with
-- settles it against the comment rather than against the guard:
--
--   ledger_entries     append-only by revoke   AUDITED
--   stock_movements    append-only by revoke   AUDITED
--   notice_reads       append-only             exempt
--   schedule_runs      append-only             exempt
--
-- > **Append-only is not the exemption test; "the row is the record" is**, and
-- > a money row fails it. The audit log records *inserts* as well as edits, so
-- > for a table that can never be edited the trail still answers a real
-- > question: **who created this, and when.** A read receipt has nobody to name.
-- > A charge does.
--
-- Migrations are immutable once applied, so `0214`'s comment stands and this
-- file is the correction — the shape `0131` used for `0129`. The rule that
-- comment broke is this codebase's own: *write down what was actually checked,
-- not what the ideal check would have been.* It asserted an exemption instead
-- of running the guard that names them.
--
-- Nothing is exempted here, so migration `0162`'s list of four is unchanged and
-- its function needs no edit.

begin;

-- The actor will usually be null on these rows, and that is correct rather than
-- a gap: the webhook has no JWT, so `audit_actor_label` renders *System* —
-- which is precisely the distinction `0163` drew between "nobody was signed in"
-- and "that login is gone".
drop trigger if exists audit_subscription_invoices on public.subscription_invoices;
create trigger audit_subscription_invoices
  after insert or update or delete on public.subscription_invoices
  for each row execute function public.audit_row_change();

commit;
