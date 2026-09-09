# Academic years — the flag nobody could move

Migrations `0195`, `0196`, `0197`.

## What was measured

`current_session_id()` is one line:

```sql
select id from public.academic_sessions
where tenant_id = p_tenant_id and is_current
limit 1
```

A flag. Fifty-four functions read it, every dated write stamps its row with it —
and **nothing in the application could set it.** `promotion` reads the list of
years, `getUserContext` reads the current one, and that was every reference to
`academic_sessions` in `src/app`. There was no way to create next year and no
way to switch to it.

On the demo school, on 9 September 2026, with 2025-2026 (1 Apr 2025 – 31 Mar
2026) still flagged current:

| table | dated outside the year they are stamped with |
|---|---|
| `attendance_records` | **6,000 of 6,000** |
| `ledger_entries` | 323 of 323 |
| `invoices` | 317 of 317 |
| `journal_vouchers` | 274 of 274 |
| `homework` | 32 of 32 |
| `book_issues` | 25 of 26 |
| `stock_movements` | 14 of 14 |
| `visitors` | 4 of 4 |
| `exams` | 2 of 2 |
| `certificates` | 1 of 1 |

And the control, which is what makes this a finding rather than a coincidence:
`staff_attendance` (765 rows) and `leave_requests` (4) are **clean**. Those are
the tables the seed dated with a fixed date inside the year; every table above
was dated `current_date - n`.

That is exactly what the application does. It dates a row today and files it
under whichever year holds the flag, so the moment the flag is stale every row
lands in a year it did not happen in — invisible to every report of the year it
belongs to, and counted in the year it does not.

Probed rather than reasoned: `mark_attendance` accepted today's date (five
months after the year ended) and also accepted `2024-06-10`, writing one row
each time, with no error either way.

## Two questions, and the flag answers neither

> **`session_id` says which year a row is filed under. The row's own date says
> which year it happened in.** Those are different questions, and
> `current_session_id()` — *which year has the school decided it is working in*
> — is a third.

`academics_session_for_date(date)` is the second question, given a name so the
codebase can stop conflating it with the third. It is arithmetic; the flag is a
decision. The decision is deliberately still a decision — a school sets next
year up in February and switches in April, and a product that switched
automatically on 1 April would file the last week of enrolment work into the
wrong year in the opposite direction.

## Years may not overlap

```sql
alter table public.academic_sessions
  add constraint academic_sessions_no_overlap
  exclude using gist (
    tenant_id with =,
    daterange(start_date, end_date, '[]') with &&
  );
```

Rule 4's exclusion constraint, and load-bearing rather than tidy:
`academics_session_for_date` and the critic below both answer *"which year does
this date belong to"*, and that question needs exactly one answer. Two
overlapping years also make `current_session_id()`'s own `limit 1` arbitrary.

The refusal is translated at the boundary, because `23P01` reads *"conflicting
key value violates exclusion constraint"*:

> Those dates overlap 2026-2027 (1 Apr 2026 to 31 Mar 2027). Two years cannot
> share a day, or no row can say which year it is in.

## Moving the dates of a year that already has arrangements in it

`academics_session_update` is where migration `0178`'s device shows itself from
the other side. `transport_assignments` and `hostel_allocations` carry
`session_starts_on`/`session_ends_on` inside a composite foreign key with
`on update cascade`, so editing a year rewrites every seat and bed made for it,
their `effective_ends_on` regenerates, and their exclusion constraints
re-check. Shortening a year under a bus seat that would then overlap next year's
is **refused** — the same shape as refusing to lower a paper's maximum below a
mark already awarded, and the same answer: that refusal is the device working.

## Activating is two statements, not one

`academic_sessions_one_current_uk` is a partial unique index over
`(tenant_id) where is_current`. A single `update … set is_current = (id = $1)`
can trip it mid-statement as btree entries are written, so the function clears
first and sets second. Both are in one transaction, so there is no window in
which the school has no current year.

## The critic, and what it deliberately does not do

`academics_filing_problems()` is a new `reference.checks` row rather than
another message on `academics.session`, because the remedy is different: that
one sends you to a rollover, this one to the year list, and a critic whose
message and whose link disagree is one people stop following. Live, as an
administrator, in 180 ms:

> 6,000 register rows are dated between 5 Aug 2026 and 1 Sep 2026 but filed
> under 2025-2026, which ended on 31 Mar 2026. They belong to 2026-2027.
>
> 1 certificate is dated on 7 Sep 2026 but filed under 2025-2026, which ended
> on 31 Mar 2026. It belongs to 2026-2027.
>
> Rows are dated today and stamped with whichever year is current, and
> 2025-2026 is current though it ended on 31 Mar 2026. 2026-2027 covers today —
> make it current under Academics → Years.

**It does not repair the 6,000 rows**, and the reason is not squeamishness:

> Re-stamping a register row's `session_id` would file it in 2026-2027 while
> `attendance_records.enrolment_id` still points at a **2025-2026** enrolment.
> The row would be consistent with the calendar and inconsistent with the
> child's place in the school.

The register was taken in August 2026 against last year's enrolments because
nobody promoted the school into this year. The repair for that is a promotion
run, which is a decision with named children in it (rule 13) — not something a
migration may do on a school's behalf. Same answer as
`transport_billing_conflicts`: name it in sentences and let a bursar decide.

## Two grammar migrations, and why they are their own migrations

`0195`'s critic said, verbatim:

```
1 certificates is dated between 7 Sep 2026 and 7 Sep 2026 ...
32 homework are dated between 30 Aug 2026 and 30 Aug 2026 ...
6000 register rows are dated between 5 Aug 2026 and 1 Sep 2026 ...
```

A plural noun with a singular verb, an uncountable noun counted, a four-figure
number with no separator, and a range whose ends are the same date. None is a
wrong answer; all four are why a school stops reading a screen that exists
purely to be acted on.

`0196` fixed the noun, the verb, the number and the range — and left `They
belong to` standing in front of one certificate. `0197` is that, and it is a
separate migration on purpose, because the lesson is worth having a number:

> **Number agreement is a property of the whole sentence.** Fixing the subject
> and the verb and leaving the pronoun is not a partial fix; it is the same
> error, one clause later, and it reads exactly as careless.

Every count-dependent word now comes out of one `worded` CTE, so the next person
adding a clause has somewhere obvious to put its two forms. English plurals are
not derivable (`entry`/`entries`, and `homework` has none), so each table
carries both.

## Not built

**A constraint refusing the write.** The honest enforcement of all this is
rule 4's boundary device on the dated tables — `session_starts_on`/
`session_ends_on` on the child inside a composite key, with a CHECK that the
row's own date falls between them — exactly as `transport_assignments` carries
it. It is not here because 6,000 rows already violate it and, as above, they
cannot be mechanically repaired: adding the constraint means deciding what a
school does with a year of registers taken against the wrong enrolments, and
that decision belongs to the school. The critic is what makes that decision
visible; the constraint is what stops it recurring, and is the next piece.
