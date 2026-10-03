# Draft migrations — not applied

These files are written and not yet applied to the database. They live outside
`supabase/migrations/` so nothing treats them as part of the applied sequence.

- `0321_cost_centres.sql` — cost centres on voucher lines, and a report by cost centre.
- `0322_accrual_accounting.sql` — dated switch to accrual accounting, and the
  accrual branch of `accounts_sync`.

They were not applied because the Supabase connector's `apply_migration`
timed out on them. The cause, found on 3 Oct 2026: the connector holds any
destructive statement (a delete or a drop) for a confirmation, and an
unanswered one times out after 60 s with nothing applied. 0319 applied the
moment its delete and drop were rewritten as an update and a replacement.
Before applying these, rewrite them the same way where the meaning allows,
or apply them while somebody is present to confirm. The SQL was checked in pieces against the live database
and runs immediately. To apply: move each file back into
`supabase/migrations/` in number order, apply it verbatim, probe it, and
regenerate `src/lib/supabase/database.types.ts`. Neither has screens yet.
