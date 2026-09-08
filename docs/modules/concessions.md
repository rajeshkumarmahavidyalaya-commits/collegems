# Concessions — the discount a school decided

**Migrations** `0171` (schema), `0172` (engine), `0173` (invoice wiring,
permissions, report). **Screen** `/fees/concessions`.
**Report** `fees.concessions`. **Critic** `concession_problems()`.

Every school this product is for has some of these: a sibling discount, a
waiver for a member of staff's own child, an RTE free seat, a merit
scholarship, a hardship remission agreed with one family in private.

None of them was expressible. The only route was a `discount` ledger entry
typed by hand, per child, per invoice, *after* the invoice had gone out — which
is exactly the failure rule 13 describes: a decision the office re-applies one
record at a time, in a different part of the app, every billing period, for as
long as the child is at the school.

---

## An award, not an inferred rule

The tempting design is to evaluate eligibility at billing time — count the
siblings, check whether a parent is on staff. It is wrong here:

> A concession is a **decision with money attached**. It is granted by somebody,
> on a date, for a reason, and it belongs in the audit log as that. A rule
> re-evaluated every billing run changes a family's bill when an elder sibling
> leaves, and nobody decided that.

So `fee_concessions` is the catalogue of what this school offers and
`student_concessions` is the award — the same shape as `certificate_templates`
/ `certificates`, for the same reason. **A reason is required** by a CHECK: a
discount with no stated cause is the one an auditor asks about and nobody can
answer a year later, and it is the shape a fraud takes.

---

## The invoice stays positive

`invoice_lines` carries `check (amount > 0)` and keeps it. An invoice says what
was **charged**; a negative charge is not a thing. What is **owed** is the
ledger, which already has a `discount` entry type, already constrains it
negative, and is already reversible by rule 6's rules.

So a concession is credited there and **no money table changed shape**. Two
things fell out of that which would have been work otherwise:

- the family sees both halves — *Tuition 11,400*, *Sibling discount −2,850* —
  which is how a school prints it and what a parent needs in order to check;
- `fees_student_balances` picked it up with **zero changes**. Verified end to
  end: 11,400 charged over 4 lines, `discounts: 2850`, balance 8,550.

**Idempotency is the unique index**, not a check —
`ledger_entries_concession_award_unique` over `(tenant, invoice, award)`,
excluding reversals, with `on conflict do nothing`. Rule 6's third library-fine
rule unchanged. Verified: a retried insert added **0 rows** and the credit
stayed at −2,850.

---

## The order, and why it is written down

Rule 12: evaluation order is part of the contract, and a comment is not enough
— migration `0059` carried payroll's order in its header while the loop
underneath prorated every allowance twice, and only the arithmetic found it.

1. By `priority`, ties broken by `code`, so the answer is deterministic rather
   than whatever the planner returns.
2. **A percentage is taken against the original charge**, never against what a
   previous concession left. 10% + 50% is 60%, not 55%. Compounding is
   defensible and is *not* what anybody means by "half fees for staff children,
   plus the sibling ten per cent".
3. A percentage may be **capped** by `max_amount` — "20%, up to 2,000".
4. **A fixed amount subtracts what is left** after the percentages, so a 1,000
   grant against a 600 remainder credits 600.
5. **The total never exceeds the charge.** A school does not owe a family money
   because three waivers stacked, and a negative invoice is not a refund — it is
   a bug that would print as one.

Rule 5 is why this is a function and not five triggers: the cap is a fact about
*all* the awards together, and no constraint sees a second row.

### Verified, with the numbers

| charge | concessions held | result |
|---|---|---|
| 10,000 | sibling 10%, staff 50% | 1,000 + 5,000 = **6,000** (not 5,500) |
| 2,000 | + capped 20%/500, grant 1,000 | 200 + 1,000 + 400 + 400 = **2,000** |
| 1,000 | + RTE 90% (priority 5) | 900 + 100 = **1,000**; the rest yield 0 |

The third row is the interesting one: the cap falls on the **lowest-priority**
awards rather than proportionally across all of them, which is what makes
`priority` mean something. A school's statutory RTE seat is honoured before its
discretionary sibling discount.

`tests/fees/concession-engine.test.ts` asserts each of those figures *and*
asserts the compounding answer is not what comes back.

---

## The critic

`grading_scheme_problems()` in a sixth place. Money makes the sentences matter
more — every one of these is a child whose bill is wrong in a way nobody notices
until a parent rings:

- an award pointing at a concession the school has **switched off**: it still
  looks live on the child's record and credits nothing;
- an award that has quietly **expired** — not a fault, a one-term scholarship is
  meant to end, but the family is about to get a bigger bill without being told;
- an award on a child **no longer enrolled**, harmless until somebody re-admits
  them and wonders why the fees are wrong.

---

## Withdrawing

`concession_revoke` sets a status; it never deletes. Money already credited
stays credited — the ledger is append-only and a concession that applied in
April *did* apply in April. Revoking stops the next invoice, and the screen says
so rather than implying a clawback.

The partial unique index `student_concessions_one_live` is on `status =
'active'`, so withdrawing frees the concession to be granted again on new terms
— the same reasoning as the partial exclusion constraint on leave, where a
refused request must not block a better one.

---

## Permissions

| | admin | accountant | teacher |
|---|---|---|---|
| `concessions.view` | ✓ | ✓ | ✓ |
| `concessions.manage` | ✓ | ✓ | |

A teacher gets `view` but no menu entry: they meet a concession while looking at
one child's account, which explains why a fee-chase list reads the way it does,
not by browsing the school's whole discount policy. A family may read their own
child's award through RLS and nothing else — being told about a discount is not
the same as being able to grant one.

---

## The report

`fees.concessions` — who holds what, why, and **what it has actually cost**. The
`credited` column is summed from the ledger rather than recomputed from the
rule, per rule 11: a number free to disagree with the family's statement is
worse than no number.

---

## Not built

**Bulk award.** Granting the sibling discount to forty families is currently
forty clicks. Rule 13 says the shape this should take — a preview that
materialises as editable rows, because the rules will get three or four named
children wrong and the person who knows is standing at the screen — and that is
a bigger build than the award itself. Doing it badly (a "select all siblings"
button that applies silently) would be worse than the forty clicks.
