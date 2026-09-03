-- Phase 2.3, part seven -- the four gaps `docs/modules/payroll.md` recorded.
--
-- Each was written down as "recorded, not solved". This closes all four, and
-- three of them turn out to be the same shape as something the codebase already
-- does, which is the argument for having written them down rather than
-- improvising each in isolation.
--
--   1. A mid-month leaver is paid for the whole month  -> a date, symmetric
--      with `date_of_joining`.
--   2. A finalised month cannot be corrected            -> a second run, typed.
--   3. Nobody is paid by this module                    -> an append-only
--      subsidiary record, the same discipline as `ledger_entries`.
--   4. Staff library fines have nowhere to settle       -> a deduction line and
--      a settlement stamp.

-- ---------------------------------------------------------------------------
-- 1. Leaving
-- ---------------------------------------------------------------------------

-- `staff` has had `date_of_joining` since migration 0003 and no counterpart, so
-- employment had a beginning and no end. The consequence was not cosmetic:
-- `payroll_preview` filters on `status = 'active'`, so marking a leaver
-- `terminated` made them vanish from payroll entirely -- including from the
-- final month they had actually worked. The honest fix is a date, and a window
-- that closes on it.
alter table public.staff add column date_of_leaving date;

alter table public.staff
  add constraint staff_leaving_after_joining_chk
  check (date_of_leaving is null or date_of_leaving >= date_of_joining);

comment on column public.staff.date_of_leaving is
  'Last day of employment. Null means still employed. Payroll pays up to and including this date and not beyond it.';

create index staff_leaving_idx on public.staff (tenant_id, date_of_leaving)
  where date_of_leaving is not null;

-- ---------------------------------------------------------------------------
-- 2. Correction runs
-- ---------------------------------------------------------------------------

-- A finalised run is the record of what was paid and must never be rewritten.
-- But a school does discover, in April, that March was wrong -- an arrears
-- award, a basic pay corrected late, somebody marked absent who was on duty.
-- The answer is not to unlock March; it is to pay the difference in a second
-- run that says so.
alter table public.payroll_runs
  add column run_kind text not null default 'regular'
  check (run_kind in ('regular', 'correction'));

comment on column public.payroll_runs.run_kind is
  'A regular run pays the month. A correction run pays the DIFFERENCE between what is now owed and what has already been paid for that month, so the two are additive and neither rewrites the other.';

-- The old index allowed one live run per month full stop, which is exactly
-- what made a correction impossible. Replaced by two narrower rules:
drop index if exists public.payroll_runs_one_live;

-- One live regular run per month -- the original rule, unchanged in substance.
create unique index payroll_runs_one_live_regular
  on public.payroll_runs (tenant_id, period_month)
  where status <> 'discarded' and run_kind = 'regular';

-- ...and at most one correction being worked on at a time. Several *finalised*
-- corrections for one month are fine -- a school can discover two mistakes --
-- but two half-built ones would disagree, which is the failure the original
-- index existed to prevent.
create unique index payroll_runs_one_draft_correction
  on public.payroll_runs (tenant_id, period_month)
  where status = 'draft' and run_kind = 'correction';

-- ---------------------------------------------------------------------------
-- 3. Paying a payslip
-- ---------------------------------------------------------------------------

-- This is NOT the general ledger. Rule 6's `ledger_entries` is a fee
-- *receivable* ledger -- `student_id` is `not null` -- and a salary is a
-- payable, so it genuinely cannot live there. A chart of accounts is Phase 2.2
-- and is still not built.
--
-- What this is: the subsidiary record that answers "has Ravi been paid for
-- March, and how". Every school needs that on the day it runs payroll, and
-- waiting for a general ledger to answer it is how the answer ends up in a
-- notebook. When Accounts arrives these rows map into it as one voucher each.
--
-- It follows rule 6's discipline exactly, because the reasons are the same:
-- append-only, signed amounts, corrections as reversing entries, idempotent on
-- the bank's own reference.
create table public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payslip_id uuid not null,
  -- Denormalised from the parent inside the composite key below, so the CHECK
  -- beneath it has a local column. Same device as `payslips.run_status`, used a
  -- third time: a payment may only ever attach to a FINALISED payslip, and that
  -- is a fact about the parent row which no ordinary CHECK could reach.
  payslip_status text not null,

  -- Signed, and positive means "paid out". A reversal is a negative row, never
  -- an update -- the same rule as the fee ledger, for the same reason: a
  -- correction that edits history is a correction nobody can audit.
  amount numeric(12, 2) not null check (amount <> 0),
  paid_on date not null default current_date,
  method text not null check (method in ('cash', 'bank_transfer', 'cheque', 'other')),
  -- The bank's own reference, a cheque number, a UTR. Idempotency hangs off it.
  reference text,
  note text,
  -- Set on a reversing row, pointing at what it reverses.
  reverses_payment_id uuid references public.payroll_payments(id) on delete restrict,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint payroll_payments_finalised_chk check (payslip_status = 'finalised'),
  -- A reversal is negative and an original is positive. Stating it as a check
  -- means a mis-signed reversal is refused rather than quietly doubling a
  -- payment.
  constraint payroll_payments_reversal_sign_chk check (
    (reverses_payment_id is null) or amount < 0
  ),

  constraint payroll_payments_payslip_fkey
    foreign key (tenant_id, payslip_id, payslip_status)
    references public.payslips (tenant_id, id, run_status)
    on update cascade on delete restrict
);

-- One payment per reference per payslip, so a retried submission converges
-- instead of paying twice. Partial, because a cash payment has no reference and
-- two of them in one day is a real thing.
create unique index payroll_payments_reference_unique
  on public.payroll_payments (tenant_id, payslip_id, reference)
  where reference is not null and reverses_payment_id is null;

-- One reversal per payment, so a retried reversal converges too.
create unique index payroll_payments_reversal_unique
  on public.payroll_payments (reverses_payment_id)
  where reverses_payment_id is not null;

create index payroll_payments_tenant_idx on public.payroll_payments (tenant_id, paid_on desc);
create index payroll_payments_payslip_idx on public.payroll_payments (tenant_id, payslip_id);

create trigger audit_payroll_payments
  after insert or update or delete on public.payroll_payments
  for each row execute function public.audit_row_change();

alter table public.payroll_payments enable row level security;

-- Append-only, and enforced by the GRANT rather than merely by the absence of a
-- policy. `ledger_entries` learned this the hard way: a table that is
-- append-only "because no policy matches an update" is one migration away from
-- not being.
revoke update, delete on public.payroll_payments from authenticated, anon;

create policy "payroll staff record payments" on public.payroll_payments
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "payroll staff view payments" on public.payroll_payments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- A person may see that they were paid, and how. This is the row-ownership
-- rule the rest of the module uses, reached through the payslip.
create policy "staff view own payments" on public.payroll_payments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and exists (
      select 1 from public.payslips p
      where p.id = payroll_payments.payslip_id
        and p.staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Staff library fines
-- ---------------------------------------------------------------------------

-- `docs/modules/library.md` has recorded since migration 0026 that a staff
-- library fine is "a payroll matter, not a fee receivable", and that it was an
-- open gap rather than a solved problem. `members` is a student *or* a staff
-- member, `ledger_entries.student_id` is `not null`, and a staff fine therefore
-- had nowhere to go and no way to be settled.
--
-- Payroll now exists, so it has somewhere: it becomes a deduction line on the
-- next payslip. What was still missing was the settlement concept -- a way to
-- say "this fine has been collected" that cannot drift from the payslip that
-- collected it. A foreign key to the payslip says both at once.
alter table public.book_issues
  add column staff_fine_payslip_id uuid,
  add column staff_fine_waived_at timestamptz,
  add column staff_fine_waived_by uuid references auth.users(id) on delete set null;

alter table public.book_issues
  add constraint book_issues_staff_fine_payslip_fkey
  foreign key (tenant_id, staff_fine_payslip_id)
  references public.payslips (tenant_id, id) on delete set null (staff_fine_payslip_id);

-- Settled or waived, never both: they are different answers to "why is this no
-- longer owed", and a row claiming both cannot be reported on honestly.
alter table public.book_issues
  add constraint book_issues_staff_fine_settled_chk
  check (staff_fine_payslip_id is null or staff_fine_waived_at is null);

comment on column public.book_issues.staff_fine_payslip_id is
  'The payslip that collected this staff fine. Null means outstanding. A student fine is not settled here -- it goes to the fee ledger at return time (migration 0026).';

create index book_issues_staff_fine_outstanding_idx
  on public.book_issues (tenant_id, member_id)
  where fine_amount > 0 and staff_fine_payslip_id is null and staff_fine_waived_at is null;
