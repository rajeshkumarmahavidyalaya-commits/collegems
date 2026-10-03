# Draft migrations — not applied

These files are written and not yet applied to the database. They live outside
`supabase/migrations/` so nothing treats them as part of the applied sequence.

- `0319_one_definition_of_the_college_on_a_certificate.sql` -- `certificate_snapshot`
  takes its `school.*` values from `certificate_school_values()`, and the critic
  that compared the two goes. That critic built a whole student certificate
  (1.6-8.9 s) and timed `/checks` out in the 3 Oct 2026 walkthrough. Checked
  in a rolled-back transaction: 9 snapshots over both colleges, 0 different.
  **Apply this one first**: `/checks` errors until it is in.
- `0320_cost_centres.sql` — cost centres on voucher lines, and a report by cost centre.
- `0321_accrual_accounting.sql` — dated switch to accrual accounting, and the
  accrual branch of `accounts_sync`.

They were not applied because the Supabase connector's `apply_migration`
timed out on them (2 and 3 Oct 2026; 0319 three times at 6.6-7.7 kB, with no
lock held and nothing applied). The SQL was checked in pieces against the live database
and runs immediately. To apply: move each file back into
`supabase/migrations/` in number order, apply it verbatim, probe it, and
regenerate `src/lib/supabase/database.types.ts`. Neither has screens yet.
