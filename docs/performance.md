# Front-end weight — what was heavy, and why

The complaint was that the platform is slow to load. This is what the numbers
said, what changed, and what is still true.

Everything here is **First Load JS** from `npm run build` — the JavaScript a
browser must download and execute before the route is interactive.

---

## The measurement came first

Guessing at performance work optimises the wrong thing. Two commands do most of
it:

```bash
npm run build                                  # the per-route table
ls -S .next/static/chunks/*.js | head          # what is actually big
```

...and then, to find out *which* routes carry a chunk:

```js
const m = require("./.next/app-build-manifest.json");
Object.entries(m.pages).filter(([, f]) => f.some(x => x.includes("6299-")))
```

That last one is the question that mattered. The biggest chunk in the app was
404 kB, and it was on exactly one route.

---

## What was found

| | |
|---|---|
| **Recharts, 404 kB, on the dashboard** | `/` was 235 kB — the heaviest route in the app, and **the first page every user sees after signing in**. Two charts imported statically by a Server Component. |
| **Zod, 91 kB, on 53 of 78 routes** | `src/lib/validations/fees.ts` exports Zod schemas *and* `formatMoney`. Eleven components wanted only the formatter and paid for the schema library — including the dashboard, `/fees/daybook` and `/library/issues`, which have no form on them at all. |
| **Four fee dialogs, statically imported** | Already rendered conditionally (`{collecting && <Dialog/>}`) and therefore assumed to be lazy. They were not. |
| **The middleware asked Supabase about every signed-out visitor** | `auth.getUser()` ran in front of every route on every request, including for browsers carrying no session cookie at all, where the only possible answer is "no user". |
| **`date-fns` for two `format()` calls** | A whole date library for something `Intl` already does — and the two calls hardcoded an English format, which rule 15 forbids. |
| **`@tanstack/react-query-devtools` in `dependencies`** | Nothing imports it. |

---

## The rule that explains three of those six

> **A conditional render is not a conditional load.** Next bundles what is
> *imported*, not what is rendered. `{open && <BigThing/>}` ships `BigThing` to
> everybody and then does not draw it.

`next/dynamic` is what makes the conditional real. Two shapes:

```tsx
// A dialog: no loading state — it is fetched on the same click that opens it,
// and a spinner that flashes for one frame is worse than nothing.
const RecordPaymentDialog = dynamic(() =>
  import("./fee-dialogs").then((m) => m.RecordPaymentDialog));

// A chart: ssr:false, because Recharts measures its container before it can
// draw, so server-rendered markup is thrown away. Give it a skeleton the same
// height as the chart, or everything below it jumps when the bars arrive.
const LazyEnrollmentChart = dynamic(
  () => import("./enrollment-chart").then((m) => m.EnrollmentChart),
  { ssr: false, loading: () => <ChartSkeleton /> });
```

`ssr: false` is not allowed inside a Server Component, which is why
`src/components/dashboard/charts.tsx` exists: the dynamic import lives behind a
client boundary so `/` stays a Server Component.

---

## …and the rule that explains the Zod one

> **A barrel that mixes a validation schema with a label helper charges every
> importer for the schema.**

A schema belongs in the browser when a form validates against it. A label does
not. `src/lib/validations/fees-display.ts` is the vocabulary and the display
helpers with **no imports at all** — the file says so, because one
`import { z }` and it silently becomes the thing it was extracted from.
`fees.ts` re-exports it, so a caller wanting both still imports once.

The same split is available in the other `validations/*` modules and has not
been done; it was worth 27 kB a route here and the others are less used.

---

## Results

| route | before | after | |
|---|---:|---:|---|
| `/` (dashboard) | 235 kB | **117 kB** | −118 |
| `/fees/students/[studentId]` | 216 kB | **143 kB** | −73 |
| `/fees` | 246 kB | **189 kB** | −57 |
| `/fees/daybook` | 206 kB | 178 kB | −28 |
| `/fees/invoices` | 212 kB | 185 kB | −27 |
| `/library/issues` | 229 kB | 203 kB | −26 |

The dashboard went from the **heaviest** route in the app to one of the
lightest, which is the one that matters most: it is what a user waits for
immediately after typing their password.

Recharts now appears in **no route's initial manifest** — it is fetched after
the page paints, and only for the people who reach the dashboard.

---

## What did *not* change, and why

**Middleware is still 94 kB.** That is `@supabase/ssr`, and the middleware
genuinely needs it: it refreshes the auth cookie, and a session that silently
stops refreshing signs people out mid-task. What changed is not its size but how
often it does work — a request with no `sb-…-auth-token` cookie now short-circuits
before constructing a client, removing a network round trip from every
signed-out page view. Middleware size is a fixed cost per deployment; the round
trip was a variable cost per visitor.

**Shared JS is still ~103 kB.** That is React, Next's runtime and the app shell.
It is downloaded once and cached across every route.

**Several routes are unchanged at ~210–233 kB.** `/exams/[examId]`,
`/notifications/log`, `/hostel`, `/fees/counter` are dense interactive screens
whose weight is their own tables and forms, not a library they did not need.
Making those lighter means splitting the screens, which is a design decision
rather than a bundling one — worth doing if they are measured as slow, not
because a number looks large.

---

## One thing this found and did not fix

`formatMoney` hardcodes `en-IN`, and so does a `formatDate` helper in
`fees/invoices/invoices-table.tsx`. Rule 15 names this exact mistake — *"never
hardcode a locale tag in a formatter"* — and `src/lib/i18n/format.ts` already has
`formatCurrency(value, locale)`. Moving 25 call sites onto it changes what
readers see (grouping and digits follow the locale), which is a behaviour change
that deserves its own commit rather than riding along inside a bundle-size fix.
It is noted in `fees-display.ts` at the point where somebody would otherwise
copy the mistake again.


---

# Server-side: the report that timed out

The front-end work above cut what the browser downloads. `pg_stat_statements`
was the other half of "too heavy to load", and it named something specific:

```sql
select round(mean_exec_time::numeric,1) mean_ms, calls, query
from extensions.pg_stat_statements order by total_exec_time desc;
```

`report_run` — **mean 6,214 ms**. The audit trail report had grown past that
and timed out at sixty seconds.

## The index was there. That was the surprise.

`audit_log` carries `(tenant_id, created_at desc)` — exactly the right index —
so the obvious diagnosis was wrong. `EXPLAIN ANALYZE` said why:

```
Nested Loop
  Join Filter: ((a.created_at >= b.from_ts) AND (a.created_at < b.to_ts))
  Rows Removed by Join Filter: 24350
  ->  Function Scan on report_day_bounds b
  ->  Index Scan using audit_log_tenant_idx  (rows=24412)
        Index Cond: (tenant_id = ...)
```

The date range is a **Join Filter**, not an Index Cond. Sixty-two rows wanted;
24,412 read and 24,350 thrown away.

> A `cross join lateral` makes its result a **relation**, and a relation is not
> a constant. The planner cannot push a column of a joined relation into a btree
> bound, so the range scan degrades to a full scan plus a filter — correct, and
> unboundedly slow.

Written as scalar subqueries, both bounds become InitPlans and land in the
Index Cond:

| same 62 rows | time | buffers |
|---|---:|---:|
| `cross join lateral report_day_bounds(…)` | 42.3 ms | 3,209 |
| scalar subqueries | **5.9 ms** | **277** |

**This is migration `0089`'s rule with a different symptom.** CLAUDE.md already
says *"when a value must be singular, write a scalar subquery, not a one-row
CTE"* — `0089` learned it for **correctness** (`fees_billable_lines` returned
every row three times). This is the same construct costing **performance**, and
it is the more dangerous half: a wrong number gets reported, a slow query gets
blamed on "the platform".

Two reports had the pattern — the audit trail and the notification log. Both
fixed (`0168`), the second before anybody hit it.

## Then: 8.4 ms to look up a name

Measuring again rather than declaring victory found the rest of it. Same index
scan, same 62 rows, one column different:

```
select a.id                                        ->   0.65 ms
select a.id, public.audit_actor_label(a.actor_id)  -> 525 ms
```

> A scalar function that queries another table is a correlated subquery wearing
> a nicer name. In a projection it runs **per row**, and every RLS policy on the
> table it reads runs with it. Resolve a set as a set: join once.

`audit_actor_label` reads `user_profiles`, which carries two permissive SELECT
policies, each calling `current_tenant_id()` and `current_role_code()` — all of
it 62 times, to name two distinct people. Replaced with a `left join` in the two
places that iterate over many rows (`0169`); the function stays for
`settings_effective()`, which calls it seven times over seven rows.

Note what this did **not** need: rewriting the 78 tables Supabase's advisor
flags for `multiple_permissive_policies`. Those cost something only while being
evaluated per row. Policies are the actual security boundary (rule 1), and
rewriting all of them to satisfy a linter is a large risk for a cost that
measurement says is now gone.

## What is left, and why it is a contract problem

| | |
|---|---:|
| filtered (a day), before | **> 60,000 ms** (timeout) |
| after `0168` | 2,260 ms → 647 ms |
| after `0169` | **190 ms** |
| unfiltered (all 24,412 rows) | 6,200 ms |

The unfiltered case has a different cause, and it is worth stating precisely
because it applies to every report:

```
select t.row_data, count(*) over () from report_audit_trail($1) limit 50
  -> Function Scan ... rows=24412    6,767 ms
select t.row_data                    from report_audit_trail($1) limit 50
  -> Function Scan ... rows=24412    6,168 ms
```

Removing the window function changed nothing, which rules out the obvious
suspect.

> **A set-returning function is an optimisation fence.** `select … from
> report_x($1) limit 50` runs `report_x` to completion and buffers every row
> before the Limit sees one. The kernel's `limit`/`offset` bound the
> **response**, never the **work**.

Rule 7 permits reports inline *because* they are capped at 1,000 rows. That cap
is applied after the report function has produced everything matching. The scan
is not the problem — counting the same 24,412 rows with the projection dropped
takes **100 ms**; producing them fully takes 6.2 seconds. The cost is entirely
per-row projection, so the only real fix is to produce fewer rows.

`0170` gives the audit trail a **declared seven-day default** — a visible,
overridable parameter stated in the report's own description, not a silent
truncation (rule 13 is explicit that returning the first N of M is the worst
available outcome). "What changed recently" is the question somebody brings to
an audit trail; "everything since the school opened" is one they should have to
ask for.

It deliberately does **not** rewrite the kernel to push `limit` inside every
report function. That would change the contract every catalog function is
written against, for one report that needed it, and the ceiling is unchanged
either way: a true `total_count` requires a full pass whatever the page size.

**One caveat, because it is the sort of thing that misleads later:** in the demo
tenant the whole log was seeded in a single burst, so seven days covers 21,576
of the 24,412 rows and the default buys little *there*. In a school where the
log accumulates a few hundred rows a day it buys everything. Tuning a default
until one seeded dataset looks fast would be measuring the fixture.

## Advisories deliberately not acted on

`get_advisors(type: "performance")` returned 337 items:

- **148 `unused_index` (INFO)** — on a demo database with almost no query
  traffic, "never used" means "nobody has run that query here yet". Dropping
  indexes on that evidence would be optimising the fixture.
- **89 `unindexed_foreign_keys` (INFO)** — real, but adding 89 speculative
  indexes costs write throughput on every insert to buy nothing measurable.
  Worth revisiting against `pg_stat_statements` on a tenant with real traffic.
- **100 `multiple_permissive_policies` (WARN)** — see above.

## Measuring as `postgres` is measuring a different query

The most misleading number in this file, and it was mine.

`checks_run()` (migration 0188) runs eight critics in one call. Timed from a
`DO` block it came back at **19 ms**, twice, steadily. Timed as an
administrator — `set local role authenticated` plus the JWT claims, which is
what a school actually gets — it is **849 ms on the first call and ~660 ms
after**.

The difference is entirely RLS. A `DO` block runs as `postgres`, which bypasses
row security, so the fast number was for a query nobody will ever execute.

Per critic, under RLS:

```
fees.concessions           845 ms      staff.left       176 ms
students.left              414 ms      templates        118 ms
schedules.reach             52 ms      settings.filled   29 ms
academics.session           26 ms      fees.billing       9 ms
```

`concession_problems` costs 845 ms on a school with **zero concessions**. Almost
none of that is rows: each of these critics joins `students`, `people` and its
own table, and every one of those carries permissive policies that are
themselves function calls. The cost is being *allowed to see* the rows, not
seeing them.

Three things follow:

- **Always time an RLS-protected read as the role that will run it.** The
  advisory about multiple permissive policies elsewhere in this file stops being
  an abstraction here: it is the whole of this number.
- **A critic that finds nothing is not a critic that costs nothing**, so a
  health surface has to be a page somebody opens rather than something on every
  screen.
- The honest ceiling for this page today is about **0.7 s server-side**, in one
  round trip that answers eight questions. Splitting it into eight round trips
  would cost more, not less.

### The fix, and why it touched no policy

**Migration 0190.** Both expensive critics were `union all`s over the same
RLS-heavy join — `concession_problems` three times, `student_exit_problems`
twice — so the cost was paid once per branch to answer questions about the same
rows.

Rewritten as `with live as materialized (…)`, computing each branch's condition
as a flag inside the single scan. `materialized` is load-bearing: without it the
planner inlines the CTE into every branch and the change does nothing.

| | before | after |
|---|---|---|
| `concession_problems` | 845 ms | **130 ms** |
| `student_exit_problems` | 414 ms | **247 ms** |
| `checks_run()` first call | 849 ms | **454 ms** |
| `checks_run()` steady | 659 ms | **378 ms** |

**No policy was changed.** Rule 1 says the policy is the security boundary, and
the `multiple_permissive_policies` advisory is still not acted on — rewriting
the boundary to make a page faster is the wrong trade and the wrong risk, and
the isolation suite that would prove such a change safe cannot run in this
sandbox. Asking the expensive question once is the same win without touching
anything that decides who sees what.
