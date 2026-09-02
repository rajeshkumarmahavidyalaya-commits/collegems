# Reporting kernel (Phase 6.1)

A catalog of reports as **data**, a set of read-model functions, and one runner.
Adding a report is a Postgres function plus a catalog row — never a route, a
component, or a filter bar.

Migrations `0043`–`0045`.

---

## What this exists to prevent

One screen per question. A school asks *"who has not paid"*, *"who was absent in
September"*, *"which books are overdue"*, *"what is Mrs Sharma's week"* — and
the naive answer is four pages, four exports, four filter bars, and four places
for the tenant filter to be forgotten. eSkooly has around forty such pages.

Eight reports ship today across five modules, and the runner renders all of
them without knowing anything about any of them.

---

## Three properties that make it safe

### 1. Every read model is `SECURITY INVOKER`

**No report function contains a `where tenant_id =`.** That is deliberate. If
isolation depended on each of eight functions remembering, the ninth would
forget. Every row a report returns has already passed the same policies a direct
select would — so a report cannot see across tenants, and a teacher's attendance
report cannot show a class they do not teach, without anybody writing the filter.

Verified against the live database: the second tenant's administrator runs every
report and gets zero rows of the first tenant's data.

### 2. The dispatcher checks the report's permission

```sql
if not exists (
  select 1 from public.role_permissions rp
  join public.roles ro on ro.id = rp.role_id
  where rp.tenant_id = ( select public.current_tenant_id() )
    and ro.code = ( select public.current_role_code() )
    and rp.permission_code = v_report.required_permission
    and rp.allowed
) then
  raise exception 'Your role cannot run the % report', v_report.name;
end if;
```

**This is the one place in the app where the permission matrix is load-bearing
rather than decorative.** RLS on `staff` and `people` is tenant-wide, so *"an
accountant may not pull the staff roster"* is a rule only the matrix expresses.

Rule 4 still holds — this is not a UI gate. `report_list` filters the catalog so
a librarian sees the two reports they can run, and `report_run` refuses the same
report if asked for by key anyway. Confirmed with a librarian JWT: the catalog
returns `students.roster` and `library.overdue` only, and
`report_run('fees.defaulters')` raises *"Your role cannot run the Fee defaulters
report"*.

### 3. The dynamic SQL cannot be steered

`report_run` interpolates `function_name` with `%I` — and that value comes from
`reference.reports`, which lives outside `public` and has `INSERT`/`UPDATE`/
`DELETE` revoked from `authenticated` and `anon`. The only writer is a
migration. There is no path from a caller's input to an identifier.

---

## Why reports run inline, given rule 7

Rule 7 says report generation goes through `jobs`, and the reason is that
unbounded report generation would block a request handler.

`report_run` is **bounded**: 1,000 rows by default, 5,000 at most, over indexed
tenant-scoped tables. That is a normal query, not heavy work — and it returns
the exact total alongside the page:

```sql
select t.row_data, count(*) over ()::bigint from public.%I($1) t limit $2
```

`count(*) over ()` is evaluated over the full result *before* `LIMIT` applies, so
one execution yields both the page and the honest total. The UI says *"showing
the first 1,000 rows; this report matched 3,412"* instead of silently
truncating.

What genuinely belongs in `jobs` is the unbounded case — a full-year export, a
rendered PDF, a scheduled emailed report. **None of those are built, and no
worker drains `jobs` yet**, so the kernel does not offer a "queue the full
export" button that would never complete. It caps, and it says when it capped.

---

## The catalog

```sql
reference.reports (
  key, name, description, module,
  required_permission  -- FK to reference.permissions, so a typo fails at
                       -- migration time rather than locking out a report
  function_name,       -- public.<function_name>(jsonb)
  parameters jsonb,    -- [{name, label, type, required, options}]
  columns jsonb,       -- [{key, label, type, align}]
  sort_order
)
```

Outside `public`, like `reference.permissions` and
`reference.notification_types`, so the schema-guard invariant stays meaningful.

Parameter types: `section`, `class_level`, `date`, `number`, `select`, `text`.
Column types: `text`, `number`, `money`, `percent`, `date`, `datetime`, `badge`.

`src/lib/validations/reports.ts` is the **only** place that knows how to read
that description. It parses rather than casts: a descriptor that drifted from
what the UI can render degrades to a plain text column instead of crashing the
page for every other report on it.

---

## The reports

| Key | Reads | Permission |
|---|---|---|
| `fees.defaulters` | `fees_student_balances` | `fees.view` |
| `fees.collection` | `fees_day_book` | `fees.view` |
| `attendance.summary` | `attendance_records` | `attendance.view` |
| `students.roster` | `enrolments` + primary guardian | `students.view` |
| `library.overdue` | `book_issues` | `library.view` |
| `timetable.teacher_load` | `timetable_teacher_load` | `academics.view` |
| `timetable.section_routine` | `timetable_for_section` | `academics.view` |
| `notifications.deliveries` | `notification_deliveries` | `communication.view` |

**Four are thin wrappers over functions that already exist, and that is most of
the point.** A report is a *view* of a module's own read path, not a second
implementation free to disagree with it. The defaulters report reads the same
balances the fee counter takes money on; an integration test asserts the two
return the same number of owing students.

Where a report needed logic that did not exist, it is written once:

- **`report_attendance_summary`** uses the attendance module's own percentage
  rule exactly — late counts as attended, an excused day is left out of the
  denominator rather than counted against the student. Two places computing
  "attendance %" differently is how a parent ends up with two numbers and no
  explanation. It **left**-joins the marks, so a class nobody marked shows
  zeroes rather than vanishing — dropping those students would quietly turn
  "nobody marked 7B in September" into "7B has perfect attendance".

- **`report_student_roster`** takes **one** guardian per student via a lateral,
  preferring the primary. A roster with three rows for a child who has three
  contacts is a roster nobody can take a headcount from.

- **`report_library_overdue`** computes the fine with the same `coalesce` chain
  as `library_return_book`, including its `2.00` fallback. The column is named
  `estimated_fine` because the charge is only booked at return (rule 6) — an
  estimate computed from a different rate than the charge would be worse than no
  estimate.

### Day boundaries, once

`report_day_bounds(from, to)` is the same lesson migration `0028` learned for
the day book: Vercel runs in UTC, so a date range built in the Node process runs
a Kolkata school's September from 05:30 on the 1st to 05:30 on the 1st of
October. Half-open, computed from `tenants.timezone`, and written once rather
than in each report that filters a `timestamptz`.

---

## The runner

One screen at `/reports`, driven entirely by the catalog.

- **A date range defaults to the last thirty days**, so most reports answer
  something useful on the first press instead of demanding two dates before they
  will say anything at all.
- **"All" is an explicit option**, never a blank. A filter left empty is
  indistinguishable from one nobody noticed, and the two mean different things
  to whoever reads the printout later.
- **Switching report clears the previous answer.** A table of fee defaulters
  sitting beneath the heading "Attendance summary" is worse than an empty state.
- **The row filter is client-side and says so** — it narrows what came back, not
  what the report matched, and the count reads "12 of 300 shown".
- **CSV exports the formatted values**, so a spreadsheet shows `₹8,640.00` and
  `12 Sep 2025` rather than raw numbers and ISO stamps.
- **The filename is the report and the date, never the parameters.** One
  carrying a section id is unreadable; one carrying a student's name is a
  privacy problem in a downloads folder.
- **`null` renders as an em dash**, never an empty cell. A blank in a printed
  roster is ambiguous between "no value" and "the column ran off the page".

The nav entry has no role filter, because `report_list` already narrows the
catalog — a librarian sees the two reports they can run rather than a menu item
leading to an empty page.

---

## A fixture repair this surfaced (`0045`)

The permission gate revealed that the **second tenant's admin role held two
permission codes** — the `communication.*` pair that migration `0038` backfilled
onto every admin role. Migration `0010` builds the demo tenant's matrix in full;
the second tenant, which exists so the cross-tenant suite has a real other
school to be excluded from, never got that step.

It went unnoticed because the isolation suite only ever asks that tenant to
*fail* to see things, and RLS does that regardless of the matrix. The kernel is
what surfaced it: that administrator could not run a single report, and in the
application would have seen almost no navigation.

Fixed for every tenant's admin role rather than just that one, so a tenant
created by a future migration cannot inherit the same hole quietly. Deliberately
admin-only — the other five roles' matrices are a product decision per tenant,
and inventing them here would be guessing on a school's behalf, whereas an admin
with no permissions is unambiguously a defect.

---

## What is not built

- **No queued exports.** Above 5,000 rows the kernel caps and says so. The
  `jobs` table is where a full export, a rendered PDF, or a scheduled emailed
  report belongs, and no worker drains it yet.
- **No PDF.** Printing goes through the global print stylesheet, which is enough
  for a roster and not enough for a letterheaded statement.
- **No saved report presets.** Parameters are not remembered between visits.
- **No charts.** Every report is tabular. A dashboard over these read models is
  a separate piece of work, and the read models are the part worth having first.
- **No tenant-authored reports.** The catalog is written only by migrations. A
  school cannot add its own query, which is the correct default — the mechanism
  that would allow it is also the mechanism that would let it read another
  school's data if the invoker rule were ever relaxed.
- **The existing module exports were left alone.** The day book, the attendance
  report and the notification delivery log still have their own CSV buttons.
  Folding them into the kernel is a follow-on cleanup, not part of building it.
