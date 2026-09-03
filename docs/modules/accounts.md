# Accounts — the general ledger (Phase 2.2)

Migrations `0072`–`0076`. The chart of accounts, double-entry vouchers, and the
mapping that posts the fee and payroll subledgers into them.

```
accounts            a typed tree: five roots, headings, postable leaves
journal_vouchers    one entry, gapless-numbered, immutable once posted
  └── voucher_lines   debits and credits, one side each
posting_rules       which accounts a source event moves — rules, not code
```

This is the capstone of the money story. Two finished modules produced entries
that "belong in a chart of accounts" and had nowhere to go until one existed:
the fee ledger (a receivable) and `payroll_payments` (a payable settled).

---

## The balance rule is enforced at post, not by a CHECK

"Debits equal credits" is a fact about *all of a voucher's lines at once*, and
no CHECK can see more than one row. It could have been a deferred constraint
trigger; it is a post-time check in `accounts_post_voucher` instead, for three
reasons:

- **A draft is allowed to be half-built.** Somebody types the first line before
  the second exists. A constraint that fired on every insert would make the
  natural way of working impossible.
- **Posting is the moment that matters** — the same instinct as
  `library_issue_book` and `payroll_finalise`. Before it, nothing is a record.
- **The message.** A trigger can refuse; it cannot easily say *"out by 40.00"*,
  which is the only number that helps somebody staring at a journal that will
  not post. The browser shows the same figure live while they type, but Postgres
  is the gate.

Three lesser rules ride along, and each is a *different* device:

| Rule | Enforced by |
|---|---|
| A line is a debit **or** a credit, never both or neither | a CHECK on the row |
| A **heading** cannot take an entry | a foreign key onto a generated `postable_flag` |
| A line's `account_type` matches its account's | a composite foreign key |
| Debits equal credits | the post function |
| A posted voucher never changes | the composite-key cascade (below) |

The heading rule is worth pausing on. `accounts.postable_flag` is
`generated always as (is_postable) stored` and sits in a unique key; every
`voucher_lines` row carries a constant `true` and points at it. A group account
has no row with `postable_flag = true`, so **it is unreferenceable** — the rule
holds by construction, with no trigger to keep in step. Verified: posting to
"1000 Assets" fails with `23503`.

---

## A posted voucher is immutable because no policy matches it

The same device as `payslips`, used a third time. `voucher_lines` carries
`voucher_status`, held equal to its header's by a composite foreign key with
`on update cascade`, and the write policy requires `voucher_status = 'draft'`.

So posting is **one UPDATE on the header**. The cascade rewrites every line, and
from that instant the draft-only policy matches nothing: an update touches zero
rows, silently, which is what RLS does. No revoke, no trigger, no
`if status = 'posted' then raise` scattered through the module.

Verified live: after posting, both `update` and `delete` against a line returned
zero rows and changed nothing.

**A correction is a reversal, never an edit.** `accounts_reverse_voucher` posts
a mirror-image voucher — debits become credits — pointing at the original with
`reverses_voucher_id`, and a partial unique index makes a second reversal
impossible. The original stays in the book exactly as it was, which is the whole
point: a ledger you can edit is a ledger nobody can audit.

Numbers are allocated **at post**, from the same gapless `document_sequences`
counter the fee receipts use (`kind = 'voucher'`, prefix `JV`). A discarded
draft therefore never burns a number — and an accountant's first question of any
voucher book is where number 47 went.

---

## The posting map is rules, not code

Hardcoding "a fee receipt debits Bank and credits Fee Income" makes the second
school — which splits fee income by class, or banks cash separately — a code
change. So `posting_rules` is rows: one per source event, naming the debit and
credit account.

Two rules ship by default:

| Event | Debit | Credit |
|---|---|---|
| `fee_cash` | 1120 Bank | 4100 Fee Income |
| `salary_cash` | 5100 Salary Expense | 1120 Bank |

`accounts_sync` walks the unposted source documents and posts each through its
rule, **swapping the sides when the cash moves the other way** — a refund, or a
reversed salary payment. It is:

- **Idempotent**, on a partial unique index over
  `(tenant_id, source_kind, source_id)`. A retried sync converges; verified with
  273 fee entries producing exactly 273 vouchers, and a second run creating
  zero.
- **Bounded per rule 7.** It posts at most `p_limit` documents and returns how
  many remain, so a first-run backlog drains in pages rather than one unbounded
  transaction.
- **Built as draft-then-post**, not by inserting posted rows directly. That
  keeps it `SECURITY INVOKER` and RLS-respecting, and routes every auto-posted
  voucher through the same balance check as a hand-written one.

### Cash basis, deliberately and documented

Income and expense are recognised **when cash moves**. Only the cash events
post: fee payments and refunds, salary payments and their reversals. The fee
subledger's memo entries — discount, fine, write-off — change what a student
owes but move no money, so they stay in the subledger and do not hit the GL.

This is a legitimate and common basis for a school, and it is a *choice*, not an
oversight. Accrual — posting invoices as receivables and payments against them —
is the natural next step; the `1130 Fees Receivable` account already exists in
the seeded chart waiting for it.

---

## The chart is data

`accounts_seed_default_chart` gives every tenant a standard Indian-school chart:
five roots, two sub-groups, and fifteen leaves. It is a starting point, not a
fixture — a school renames the bank, splits fee income by class, adds heads,
and none of that is a release.

The only fixed points are the five roots (the type decides normal balance and
which total an account rolls into, so it is not free text) and the handful of
`is_system` accounts the posting map points at, which may be renamed but not
deleted.

`accounts_chart_balances` rolls a heading's balance up from everything beneath
it with a recursive ancestor closure, and presents each in its **natural
direction** — debit for assets and expenses, credit for the rest — so "Bank
40,000" reads positive when there is money in it. Verified: Assets = Current
Assets = Bank = ₹38,14,000 with only current assets posted.

---

## Separation of duties

RLS restricts every accounts table to `admin` and `accountant`. The permission
matrix draws one line RLS deliberately does not: **reading the books is not the
same as posting to them.**

| | `accounts.view` | `accounts.post` | `accounts.manage` |
|---|---|---|---|
| admin | ✓ | ✓ | ✓ |
| accountant | ✓ | ✓ | ✓ |
| everyone else | — | — | — |

Both finance roles get all three today, but the codes exist so a school that
hires a bookkeeper, or wants its head teacher to see the trial balance without
being able to write a journal, does it by ticking a box rather than waiting for
a release.

---

## What the screens do

- **`/accounts`** — the chart with rolled-up balances, the trial balance, and
  the posting rules, in three tabs. A banner counts unposted source documents
  and offers to post them; it says plainly that running it twice is safe.
- **`/accounts/vouchers`** — the voucher book. A journal is written and posted
  in one dialog, with the out-of-balance figure updating live and the post
  button disabled until it ties. A posted voucher offers *Reverse*, never
  *Edit*.
- **`/accounts/[accountId]`** — one account's statement, with an opening balance
  folding everything before the window into a single line and a running balance
  down the page, like a passbook.

The trial balance states in words whether the books tie, and says so as a
`aria-live` region — because "the two columns are equal" is the sentence the
screen exists to produce.

---

## What is not built

- **Accrual accounting.** As above: invoices are not posted as receivables. The
  account exists; the posting rule and the sync branch do not.
- **No profit-and-loss or balance-sheet statement.** The trial balance is the
  raw material for both; grouping it into a P&L needs a little more chart
  metadata (which headings are "above the line").
- **No financial-year close.** Nothing rolls income and expense into retained
  surplus at year end, so a multi-year trial balance accumulates. `3200 Retained
  Surplus` is seeded for when it does.
- **No cost centres or funds.** A school running a hostel and a bus service
  separately would want a second dimension on each line.
- **No bank reconciliation.** `payroll_payments` carries a reference and the
  fee ledger carries one too, but nothing matches them against a statement.
- **Cash and bank are one account for fee receipts.** The posting rule has a
  single debit account, so a cash receipt and a bank transfer both land in
  1120. Splitting by `method` needs richer rules than one row per event.

---

## Verification

`tests/accounts/accounts-shapes.test.ts` — 24 pure assertions on the balance
arithmetic a browser owns: an empty box is zero not NaN, a negative is refused
rather than silently flipped, paise across several lines still tie, and a
voucher of zero is not "balanced".

`tests/accounts/accounts-flow.test.ts` covers the ledger invariants against the
real database, and the four accounts tables are in the cross-tenant isolation
suite. Every guard was also driven directly through SQL while the module was
written:

| Property | Result |
|---|---|
| sync of the whole demo | 274 vouchers, 548 lines |
| every posted voucher balances | 0 unbalanced |
| the books tie | DR 38,59,200 = CR 38,59,200 |
| trial balance | Bank 38,14,000 DR · Fee Income 38,59,200 CR · Salary 45,200 DR |
| second sync | 0 created, 0 remaining |
| one voucher per source document | 273 fee entries → 273 vouchers |
| update a posted line | 0 rows matched |
| post to a group heading | refused (`23503`) |
| a line claiming the wrong account type | refused (`23503`) |
| a zero-amount line | refused (`23514`) |
| an unbalanced voucher | refused — *"out by 40.00"* |
| reversal | mirrored, posted, numbered; a second refused |
| heading rollup | Assets = Current Assets = Bank |

**The usual caveat:** the demo database has only the two admin logins, so the
accountant-versus-admin distinction is asserted structurally rather than
exercised by a real second account.
