# Store (Phase 5.5)

What the school holds, and what happened to it.

Migrations `0102`–`0105`.

---

## Quantity on hand is a sum, never a column

The tempting design is `items.quantity_on_hand`, incremented and decremented.
It is the same mistake `book_issues.fine_paid` was (migration `0026`): a stored
total that is free to disagree with the events that produced it, and it always
eventually does — a failed transaction, a hand-edit, a double-click.

So stock follows rule 6's instinct exactly, applied to goods instead of money:

```
stock_movements   what happened, append-only, signed
stock_on_hand()   the sum of it, computed on read
```

**There is no column to read instead.** `stock_on_hand` is the one definition,
used by the screen, the reorder list and the issue check alike, so none of the
three can disagree about how many of something the school has.

Everything else follows from that:

| Ledger rule | Here |
|---|---|
| Signed amounts, positive means "more" | `quantity` is signed, and `stock_movements_sign_chk` ties the sign to the kind |
| RPCs take positive numbers and do the signing | `stock_record_movement` — never ask somebody at a counter for a negative |
| Corrections are reversing entries | `stock_reverse_movement` writes an opposing movement; the original stays |
| UPDATE/DELETE revoked outright | `revoke update, delete on stock_movements` |

That last one is worth contrasting with `enquiry_follow_ups`, which achieves
append-only by having **no policy**. Both are correct; they fail differently. A
revoked table *raises* `42501: permission denied`; a policy-less table silently
matches nothing. The store gets the revoke because a store ledger somebody can
edit is a store ledger that will be edited on the day the count does not tie.

---

## You cannot issue what you do not have

A fact about every other movement of the item, so no CHECK reaches it — the same
genre as a bus with forty seats and debits equalling credits. Checked in
`stock_record_movement`, under an advisory lock on the item so two clerks
issuing the last box cannot both pass, with the numbers in the message:

> *"There are 15 box of Chalk (white) on hand and you are taking out 999"*

**An `adjustment` is deliberately exempt.** A stock count that finds fewer than
the ledger says is exactly the movement that must be allowed to take stock
negative — refusing it would leave the ledger permanently wrong, which is worse
than a number a person can see is wrong.

---

## The bug in the message

The first version of that refusal read:

> *"There are 15. box of Chalk (white) on hand and you are taking out 999.."*

`to_char(15, 'FM999999990.99')` yields `15.` — the decimal point survives even
when nothing follows it. Payroll hit this in migration `0059` and solved it with
`hr_format_days`; inventory hit it again three lines into its first error
message, which is the signal that the helper was never really about days.

Migration `0105` generalises it into `format_quantity(value, decimals)` and
makes `hr_format_days` a wrapper. The rule underneath is small and worth
keeping:

> **A message that exists to be read is code too.** "15. box" is the kind of
> thing that makes a careful person distrust the number next to it.

---

## Items, and two settings that matter

- **`reorder_level = 0` means "do not track".** Without that, every projector
  sits permanently on the reorder list and the list stops being read. It is the
  honest default for anything the school does not restock.
- **`is_asset` marks what is lent and expected back**, rather than consumed. It
  changes nothing about the ledger and everything about the screen that reads
  it: `stock_issued_assets` groups issues less returns per holder, so somebody
  who returned everything nets to zero and drops off the list on their own.

**Items are not session-scoped.** A box of chalk outlives an academic year and
so does a projector. The *movements* carry the session, because "what did we
spend this year" is always asked about a year.

Verified on the demo: 100 received less 85 issued is 15 on hand; assets 8 less 3
is 5; the reorder flags fire at or below the level and never for a zero level;
average cost is weighted over receipts only, because **a store that values its
issues invents numbers**.

---

## Screens

| Route | What |
|---|---|
| `/inventory` | what is on the shelf, low stock first, plus what is out with people |
| `/inventory/[itemId]` | one item's movements with a running balance |

The item ledger is the same shape as the general ledger's account statement, and
for the same reason: *why do we have eleven of these* has to be answerable a
year later.

---

## Permissions

The line the matrix draws: **keeping the store is not the same as writing off
what is missing.** A store keeper issues chalk all day; deciding that six
projectors are gone is a different decision with a different signature on it.

- `inventory.view` — items, stock, the ledger
- `inventory.manage` — add items, receive and issue
- `inventory.adjust` — adjust or write off after a count

`librarian` holds `manage` because in most schools the store keeper and the
librarian are the same person.

---

## Not built

- **No purchase orders or supplier records.** A receipt carries a supplier name
  as text. Real procurement — orders, approvals, part deliveries, invoices
  matched to receipts — is its own module.
- **Nothing posts to the general ledger.** A receipt is a purchase and belongs
  in `accounts` as one; the posting rule and the sync would follow the pattern
  `accounts_sync` already sets, and are not written.
- **Valuation is average cost only.** No FIFO, no batches, no expiry dates —
  which a school store with medicines or food would need.
- **No stock-count workflow.** An adjustment is a single movement; a proper
  count is a bulk preview-then-apply, which is rule 13 work.
- **No per-location stock.** One school, one store. A school with two campuses
  needs a location dimension on every movement.
