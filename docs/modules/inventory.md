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

---

## Selling from the store

Phase 3b's last self-contained item. The roadmap's note read *"`stock_movements.kind`
is `adjustment | issue | receipt`; a sale also crosses into the fee ledger"* —
and the first half was measuring the **data in use**, not the constraint:
`stock_movements_kind_check` has listed five kinds since the module shipped. The
second half is exactly right, and is what makes this a money change.

### The pattern was already written down

Rule 6 writes library fines up as the shape for *"any module that wants to write
here"*, and a sale takes all three points unchanged:

| | library fine | store sale |
|---|---|---|
| when the charge is booked | at return, when the amount is final | at the counter, same reason |
| the narrow door | `entry_type = 'fine'` + `book_issue_id`, librarians only | `entry_type = 'sale'` + `stock_movement_id`, store keepers only |
| idempotency | partial unique index on the source row | the same, excluding reversals |

That narrow INSERT policy is what keeps `stock_sell_to_student` `SECURITY
INVOKER` — the two policies are the boundary, and the role check inside only
turns `42501` into a sentence.

**Price is not cost.** `unit_cost` is what the school paid (already restricted
to `receipt` and `adjustment`); `unit_price` is what the family pays. A school
buys exercise books at 18 and sells at 25, and one column would make the store's
margin unanswerable. `inventory_items.sale_price` is the default and **null
means not for sale** — different from 0.00, and the reason a school can stock
chalk and floor cleaner without either being on a menu.

**A sale is to a student.** `ledger_entries.student_id` is `not null`, so a sale
to staff cannot reach the fee ledger at all — the same wall that sent staff
library fines to payroll. Not built, named.

### Two writes, and a correction is two more

`fees_reverse_entry` would cancel the charge and leave the goods off the shelf.
So it refuses a sale by name and sends it to `stock_sale_reverse`, which puts
the stock back as a `return` and reverses the charge — the same shape as
`stock_record_movement` refusing `kind = 'sale'` and sending it the other way.
**Two functions, each refusing the other's job in a sentence**, rather than one
that quietly does half.

And the hazard `0026` had already written down, one column along:

> `fees_reverse_entry` copied `invoice_id` but knew nothing about book issues,
> so reversing a library fine would have produced an entry with no link back to
> the book — invisible to the librarian policy above.

Identical here: a reversal dropping `stock_movement_id` is invisible to the
store keeper's own SELECT policy, so the person who made the sale sees the
charge and not its cancellation. **A new source column on `ledger_entries` is
not one change, it is two** — and the note from 2026's January is what caught
it.

---

## Two things the build found that were not about selling

### `allowed_values` was reading a different constraint's list

`0222` added it so *"a validator and an error message can consult the constraint
instead of carrying a second copy of the list"*. The first thing asked of it
after `0261` was the sanity check:

```
select array_length(allowed_values('public.stock_movements','kind'), 1);   -- 2
```

Six kinds, answer **two**. It matched any CHECK whose text contains `kind = ANY
(ARRAY[`, took the first by name, and `stock_movements_cost_chk` — *where a cost
may be recorded* — sorts before `stock_movements_kind_check`.

> This codebase's oldest recurring defect, in the one place built to prevent it:
> **a plausible answer rather than an error.** Two is a number somebody quotes.

Invisible because both live callers ask about a column with exactly one matching
CHECK. Measured across the five columns anything asks about, the loose pattern
matches two for `stock_movements.kind` and two for `ledger_entries.entry_type`;
**anchored on `CHECK ((col = ANY (ARRAY[`, exactly one for all five.** It now
returns null rather than choosing when two match, which degrades to the
behaviour `0222` already documented: the sentence stops naming the values and
the CHECK still refuses the write.

And the second copy this was always about: `stock_record_movement` opened with
its own list of kinds beside the constraint that holds one. Migration `0101`'s
defect, in the module `0101`'s own convention names. It consults the constraint
now, so the next kind is one `ALTER`.

### The sale worked, both rows were right, and the balance did not move

The probe's first run:

```
SALE   total 50.00 | on hand 15.00 -> 13.00 | balance 1100.00 -> 1100.00
```

Stock left the shelf, a correctly signed and linked immutable charge was
written, and **the only screen that collects the money never saw it.**

|  |  |
|---|---|
| today | 2026-09-21 |
| the flag says | **2025-2026** |
| the date falls in | **2026-2027** |
| the balance reads | 2025-2026 |

`stock_sell_to_student` stamped the charge with the *date's* year;
`fees_student_balances` filters on the *flag's*. Rule 2 already settled which
one a charge takes — **a row that bills a year is not a row that records a
day** — and a sale is genuinely both, so it writes two rows with two different
`session_id`s on purpose: the movement from the date (`0198`), the charge from
`current_session_id()`.

**That split was in the precedent too.** `library_return_book` — the function
rule 6 names as *the* pattern — dates the issue and bills the fine with
`current_session_id(v_tenant_id)`, one statement below the three bullet points
that were copied. Migration `0264`.

> **Assert the number a person reads, not the rows you wrote.** Every assertion
> about rows passed. Nothing was wrong, and the answer was still invisible.

### Probed, all rolled back

```
SALE      50.00 | on hand 15.00 -> 13.00 | BALANCE 1100.00 -> 1150.00 (+50.00)
HALF-REV  That charge is a sale from the store. Use stock_sale_reverse, which
          also puts the stock back
REVERSED  on hand 13.00 -> 15.00 | BALANCE 1150.00 -> 1100.00 | twice: That
          sale has already been reversed
TEACHER   Your role does not sell from the store
NO PRICE  A4 paper has no price, so it cannot be sold. Give it a sale price on
          the item first
LEAVER    Saanvi Gupta has left the school, so nothing can be sold to them
TOO MANY  There are 13 box of Chalk (white) on hand and you are selling 99999
```

The teacher login was created for the probe, because this college has none —
*the roles a reason forgets are the roles nobody signs into.*

## The counter

Migration `0265` and the screens. The write path had been correct and uncallable
— rule 6's own sentence — and building the caller found the defect the caller
would have triggered.

### The refusal that was written into one function

`0263` wrote the rule down and guarded the *other* module with it: a correction
to a sale is two writes, so `fees_reverse_entry` refuses one by name and sends
it to `stock_sale_reverse`. It named two doors and there are three.
`stock_reverse_movement` is the one the item screen **already drew a button
for, on every row**, and it was left accepting a sale. Probed as an
administrator in a rolled-back transaction, before the fix:

```
stock  15.00 -> 13.00 (sold 2) -> 15.00  after stock_reverse_movement
owed    8.00 -> 58.00 (charged) -> 58.00  after stock_reverse_movement
```

The goods come back and **the family stays charged**. Nothing raises, nothing
disagrees out loud, and the shelf and the fee account have quietly parted
company.

> **A rule written into one function is not a rule.** Rule 12 asks *who else
> does this?* about a fix. A refusal has the sibling question: **what else
> reaches this row?**

After `0265`, probed the same way: the wrong door answers *"That is a sale, so
reversing it has to return the goods and cancel the charge together"*, and the
right one takes stock 13 → 15 **and** owed 58.00 → 8.00.

`tests/inventory/a-correction-is-two-writes.test.ts` is the executable half and
runs without a database. Five plants, each caught and each green on revert.
**Two of its own assertions were wrong before any of them**, and both reported a
correct function:

- `fees_reverse_entry` refuses on `stock_movement_id is not null`, which is
  **stricter** than `entry_type = 'sale'` — it catches any charge tied to stock
  whatever its type. The guard demanded the narrower spelling.
- `stock_record_movement` names `stock_sell_to_student`, because it refuses an
  attempt to **create** a sale rather than to undo one. The guard demanded the
  un-seller.

*A guard that reports a correct file is a guard somebody switches off.* Read
which of the two you have before changing anything.

### Three columns nobody could see

The same omission one column along: `0261` added `sold_to_student_id`,
`unit_price` and `sale_price`, and no reader was taught to show any of them. The
item history said two exercise books left the shelf and **could not say to
whom** — `stock_ledger` coalesced a staff name, a note and a supplier, and a
sale matched none of the three. `stock_on_hand` had no `sale_price`, so no
screen could tell *not for sale* from *free*.

Both are `drop` + `create`, because the return type changes; checked first that
the three read models are called from this module's own `actions.ts` and one
test file and from no other function, report or check. And a name is built with
`coalesce`, not `a || ' ' || b`, which is null for anybody with no surname —
true of people on this roll, and the reason a staff issue could already show a
blank where a name belongs.

### The screens

- **`/inventory`** — a *Sells for* column, a *Sell* button, and a dialog that
  charges the child's fee account. The button is drawn only when the counter
  could actually serve somebody: a price, still stocked, some on the shelf.
  *Not for sale*, *out of stock* and *no longer stocked* are three different
  reasons and each is already on the row, so a button that would refuse you is
  never drawn — this codebase's third instance of that defect in a week.
- **The item form** gains *Sells for*, empty by default. Empty means **not for
  sale**, and the help text says so: writing 0 would say the school gives it
  away.
- **`/inventory/[itemId]`** gains a *Sold at* column beside *Unit cost* — two
  facts, two columns, so "what was our margin" stays answerable — the buyer's
  name, an *Undone* badge, and an undo that routes a sale to `reverseSale` and
  everything else to `reverseMovement`.

The child is chosen with the shared `<StudentPicker>` (`0259`), which takes this
module's own server action as a prop: the choreography is shared, the
authorization is not. A child who has left is **listed** with their status
rather than filtered out — `stock_sell_to_student` refuses them by name, and a
picker that silently omitted them would leave the clerk searching for somebody
who is there. The refusal explains; an empty list does not.

Both toasts say **both halves**. *"Sold 2 box to Vihaan Singh · ₹50.00 added to
their fee account"*, and on the undo *"₹50.00 came off the fee account"* —
because saying only *Sold* is how a store comes to believe nobody was charged.

### Who may

Gated on `inventory.manage`, deliberately rather than on a new
`inventory.sell`: the two INSERT policies compare three role codes, and those
are **exactly** today's `inventory.manage` holders, so a separate permission
would be a control the boundary cannot honour — granting it to a teacher would
still end in a refusal from Postgres. The catalogue description was the thing
that went stale, and `0265` updates it: *a catalogue description is a decision
somebody already made*, which cuts both ways.

Probed as all six seats, one item, one child:

| seat | outcome |
|---|---|
| admin | sold, ₹25.00 |
| accountant | sold, ₹25.00 |
| librarian | sold, ₹25.00 |
| teacher | *Your role does not sell from the store* |
| parent | *Your role does not sell from the store* |
| student | *Your role does not sell from the store* |

### The cost

Measured, before and after, whole build: `/inventory` **238 → 247 kB** — the
Radix Popover behind the picker, now shared with three other routes, plus the
dialog. `/inventory/[itemId]` **195 → 195 kB**: the undo branch is free.
`First Load JS shared by all` is 103 kB either way.
