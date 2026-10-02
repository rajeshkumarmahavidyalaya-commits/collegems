# Draft migrations — not applied

These files are written and not yet applied to the database. They live outside
`supabase/migrations/` so nothing treats them as part of the applied sequence.

- `0319_cost_centres.sql` — cost centres on voucher lines, and a report by cost centre.
- `0320_accrual_accounting.sql` — dated switch to accrual accounting, and the
  accrual branch of `accounts_sync`.

They were not applied because the Supabase connector timed out on payloads of
this size (2 Oct 2026). The SQL was checked in pieces against the live database
and runs immediately. To apply: move each file back into
`supabase/migrations/` in number order, apply it verbatim, probe it, and
regenerate `src/lib/supabase/database.types.ts`. Neither has screens yet.
