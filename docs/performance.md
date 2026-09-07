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
