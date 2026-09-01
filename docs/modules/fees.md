# Fees module

The money module. Everything else in SchoolOS can be corrected by editing a
row; this one cannot, on purpose.

CLAUDE.md rule 6 says payments, discounts, fines and refunds are immutable
ledger entries, corrections are reversing entries, and receipt numbers are
gapless per-tenant-per-session sequences generated in Postgres. This document
is how that is actually enforced, and where it deviates.

---

## Two halves, kept apart

```
charges   invoices ──< invoice_lines          what the school billed
ledger    ledger_entries                      every movement against those charges

balance = Σ lines of issued invoices + Σ ledger entries
```

Keeping them separate is what makes the balance a single, checkable sum. Every
row returned by `fees_student_balances()` satisfies:

```
charged + fines - discounts - write_offs - paid + refunds = balance
```

The integration suite asserts that identity for every student, and so does the
seed check — 300 rows, no exceptions.

## One ledger table, not four

`docs/domain/erd.md` originally sketched separate `payments` / `discounts` /
`fines` / `refunds` tables. That was the wrong shape and the roadmap entry has
been updated to match what was built.

Four tables would mean four sets of RLS policies, four audit triggers, four
reversal mechanisms, and a five-way `UNION` every time anything asks "what does
this child owe". One `ledger_entries` table with a typed `entry_type` gives the
same guarantees, makes the balance one `SUM`, and makes reversal uniform.

## The sign convention

**`amount` is signed, and positive always means "the student owes more".**

| Entry type | Sign | Receipt number | Method |
|---|---|---|---|
| `fine` | + | no | no |
| `refund` | + | yes | yes |
| `payment` | − | yes | yes |
| `discount` | − | no | no |
| `write_off` | − | no | no |

A refund is positive because money going back to a payer restores the debt.

This is not a convention held up by discipline — `ledger_entries_sign_chk`
encodes the table above, and inverts it when `reverses_entry_id` is set. A
payment inserted with a positive amount is rejected with `23514`. There is a
test for exactly that.

`ledger_entries_method_chk` does the same job for the third column: an entry
that moved cash must name a method, and one that did not must not have one.

**The RPCs take positive amounts.** `fees_record_payment(student, 5000, 'cash')`
books `−5000`. Asking a caller to pass a negative number is how sign bugs get
into money.

## Nothing is ever updated or deleted

`ledger_entries` and `invoice_lines` have:

- no `UPDATE` or `DELETE` policy, and
- `revoke update, delete ... from authenticated, anon`

The revoke is the belt to the policy's braces: a future `for all` policy added
by mistake still cannot rewrite a ledger row. An attempted update fails with
`42501` — a *privilege* error, not a policy miss — which is the signal that the
guarantee is structural.

Neither table has an `updated_at` column, because neither is ever updated.

### This broke reversal, and immutability won

`fees_reverse_entry` originally took `select ... for update` to lock the row it
was mirroring. Postgres requires the UPDATE privilege for a row lock, so every
reversal failed with `permission denied for table ledger_entries`. The two
requirements genuinely conflict.

The lock went, not the revoke (migration `0023`). Nothing was lost: the lock was
never what made double-reversal safe — `ledger_entries_reversal_unique` is. Two
concurrent reversals both pass the friendly pre-check and the second fails on
the unique index, which the server action turns back into "That entry has
already been reversed".

### The one mutable thing on the charges side

An invoice can be **cancelled** — `status`, `cancelled_at`, `cancelled_by`,
`cancel_reason` — and only while no ledger entry references it. Once money has
been recorded against a bill, the correction is a reversing entry, not a
cancellation. `invoices_cancel_reason_chk` makes a cancellation without a
recorded who and why impossible.

The *lines* are never touched. A cancelled invoice keeps every line it was
issued with, because it is a record of what was charged.

## Gapless document numbers

A Postgres sequence is the wrong tool here: sequences deliberately do **not**
roll back, so a failed payment would burn a receipt number and leave a hole —
and an auditor reads a hole in a receipt book as a missing receipt.

`document_sequences` is an ordinary counter row per (tenant, session, kind).
`fees_next_document_number()` increments it inside the caller's transaction, so
the `UPDATE` takes a row lock and a rollback returns the number to the pool.
Concurrent receipts at one cash desk serialise, which is the right trade.

Format: `RC-2025-00001`, `IN-2025-00001`. The counter is created on first use,
so nothing has to seed one per tenant per year.

A **reversal carries no receipt number**. It is not a fresh cash movement, it is
the cancellation of one, and it names the receipt it cancels through
`reverses_entry_id`.

## Payment-gateway idempotency

`ledger_entries_provider_event_unique` on `(tenant_id, provider,
provider_event_id)` is the whole story — the constraint, not application code.

`fees_record_payment` looks for an existing entry with that event id **before**
allocating a receipt number, and returns it if found. Order matters: checking
afterwards would burn a number on every redelivery and put gaps in the book.

Verified: the same `evt_ABC123` sent twice returns the *same row* with the
*same receipt*, and the sequence counter does not advance.

> **Not built:** the gateway integration itself. The schema and the idempotent
> write path are here and tested; a Razorpay/Stripe Edge Function is a thin
> adapter over `fees_record_payment` with `p_provider` and
> `p_provider_event_id` set, and it needs real API keys.

## Cross-tenant integrity — a bug worth reading about

Driving `fees_record_payment` as tenant B with a hardcoded tenant A student id
**succeeded**. The row landed in tenant B (tenant_id comes from the JWT, so
RLS's `WITH CHECK` was satisfied) while `student_id` pointed at a student in
tenant A.

The cause: **foreign key checks are not subject to RLS.** A plain
`references students(id)` sees every row in the table, invisible ones included.

The fix (migration `0024`) is structural rather than another `if` in every
function: `students` and `invoices` got `unique (tenant_id, id)`, and the
children point at *that* with a composite foreign key. "The child's tenant must
equal the parent's tenant" is now a database constraint that holds for every
write path — the RPCs, a raw PostgREST insert, a function nobody has written
yet.

`attendance_records` had the same shape and got the same treatment in the same
migration.

The functions also gained a friendly "Student not found" check, but that is
only for the error message. The constraint is what makes it safe.

## RLS

| Role | Can |
|---|---|
| `admin`, `accountant` | Read everything, insert ledger entries, manage invoices and the fee catalog |
| `student` | Read own invoices, lines and ledger entries |
| `parent` | Read those of children linked through `guardian_student` |
| everyone else | Nothing |

Nobody, in any role, gets UPDATE or DELETE on the ledger.

## The screens

### `/fees` — collection

The defaulters-first view. Server-side paged and sorted through
`fees_student_balances()` — PostgREST applies `.order()` and `.range()` to a
set-returning function the same way it does to a table, so sorting by balance
across 300 students never pulls 300 rows to the browser.

Balance state is named, never colour alone: **Outstanding**, **In credit**,
**Settled**. "In credit" is its own state rather than folded into "settled",
because the school is holding that family's money and may owe a refund.

Search filters the page in hand rather than the whole set — the balance
function has no text predicate, and adding one would mean sorting and paging in
two places. Class and outstanding-only are the filters that matter here;
finding one child by name is what ⌘K is for.

Written-off and refunded columns exist but are hidden by default, so the table
stays readable on a front-desk laptop.

### `/fees/students/[studentId]` — the ledger

Where append-only becomes visible to the person using it. A reversed entry is
shown **struck through, not hidden**, with its mirror beneath it — the ledger is
the record, and hiding a cancelled receipt is how a book stops matching the
receipts a parent is holding in their hand.

The reversal dialog says so in as many words before you confirm: *"The original
entry stays on the ledger."* That is the thing that surprises people — a
reversal is not a delete.

Charges are red-ish and credits green-ish, but the sign is always spelled out
with a `+` or `−` and the entry type is named.

### `/fees/setup` — catalog and billing

Fee heads, per-class amounts, and raising invoices. Amounts are grouped by
class rather than by head, because that is the unit a school thinks in.

Setting an amount that already exists **upserts** on
`(tenant, session, class level, head)` — it is an edit, not a duplicate row.

Raising invoices for a class skips students who already have one for that due
date, so running it twice tops up rather than double-bills. Bounded to a
section (~40 students) on purpose: billing a whole school belongs in `jobs`
(rule 7) and is not built.

Removing a class amount warns that invoices already raised are unaffected —
an issued invoice is a record of what was charged.

## Known, deliberate gaps

- **No gateway integration.** Schema and idempotent write path only; see above.
- **No recurring billing.** `fee_structures.frequency` describes the intended
  cadence but nothing generates instalments on a schedule. That is a `jobs`
  concern.
- **Whole-school invoicing is not offered**, only per-section, for the same
  reason.
- **Library fines have not moved into this ledger.** CLAUDE.md rule 6 said they
  should once the ledger existed. It now does, and they have not moved — see
  the note there for what the migration involves and why it was not folded into
  this change.
- **No receipt printing or PDF.** The receipt number and every field a receipt
  needs are stored; rendering one is not built.
- **`fees_student_balances()` recomputes on every call.** Correct at one
  school's scale and it keeps the balance underivable-but-always-right rather
  than a cached column that can drift. A school with tens of thousands of
  students wants a read model built by a job instead.
