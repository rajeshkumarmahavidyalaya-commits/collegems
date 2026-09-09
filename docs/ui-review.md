# A UI pass with the app actually running

There is no Supabase egress from the build sandbox, so every screen behind a
login is unreachable here. **One screen is not**: `/login` renders without a
session, and it happens to be the screen this product had least looked at.

So this pass is what a browser could be pointed at — `next build && next start`,
Chromium via Playwright, four widths, both colour schemes, and the locale cookie
set by hand. Everything below was seen before it was written.

## What the screenshots showed

### The branding panel was English inside an RTL page

`LoginBranding` carried two hardcoded English sentences while the rest of the
page went through `t()`. Rendered with `schoolos-locale=ur`, `dir="rtl"`:

```
.else that keeps a school running
.who buy the software
```

The full stops have moved to the **start** of the line. That is the bidi
algorithm doing exactly what it should: a neutral character at the end of an
LTR run inside an RTL paragraph belongs to the paragraph, not the run. The text
is not merely untranslated — it is mis-punctuated, and only in the language
nobody on the team reads.

> Untranslated text in an RTL locale is not "English for now". It is broken
> typography, and it is invisible from the default locale.

Fixed by translating it: `login.brandHeadline`, `login.brandSub` and
`login.copyright` in all three locales. The product name is wrapped in `<bdi>`
so a translation that puts `SchoolOS` mid-sentence cannot have the surrounding
direction leak into it — defensive rather than a fix for what was on screen.

### The one screen that needs the language control did not have it

Rule 15 says the cookie step exists because *"somebody who cannot read the
default has no profile yet, so it is the only place their choice can live on the
login page"*, and `LOCALE_COOKIE` is commented **"the cookie the login page
writes"**. The login page had no language control at all, so the cookie was only
ever written from inside the app shell — after signing in, which is the one case
it was not for.

`LanguageSwitcher` is now on `/login`, with a new `showLabel` prop that puts the
current language's **own name** beside the globe (`اردو`, not a globe icon and a
guess). Measured tab order, first five stops:

```
button:Choose a language → input:email → input:password
  → button:Show password → button:Sign in
```

The control a reader who cannot read the page needs is the first thing the
keyboard reaches.

### A phone saw an unlabelled form

The branding panel is `hidden lg:block`, so at 375px the page was a heading, two
inputs and a button on a plain field — no logo, no product name, nothing saying
what you are signing in to. That is the screen most parents will ever see.
`LoginBrandingCompact` puts the mark and the name above the heading below `lg`.

## Three strings that existed and were never rendered

Grepping for callers after the above turned up the same shape three more times —
a translated string in the catalogue, in Hindi and Urdu, with no caller:

| key | translated into | rendered |
|---|---|---|
| `app.skipToContent` | en, hi, ur | **nowhere** |
| `app.theme.toggle` | en, hi, ur | nowhere (a hardcoded `aria-label="Toggle theme"` instead) |
| `app.theme.light/dark/system` | en, hi, ur | nowhere (hardcoded `Light`/`Dark`/`System`) |

`main#main-content` has been the target of a skip link since the shell was
written. The link was never there, so a keyboard user landed on every page at
the top of a sidebar with nine groups in it and tabbed through all of them to
reach the thing they had opened. It is now the first focusable element, visible
only on focus.

Two more while in there: the sidebar's `<nav>` had no accessible name (there are
two navigations — the rail and the mobile drawer — and "navigation, navigation"
is no help), and the collapse button's label was hardcoded English.

## What was measured, and what was not

- **No horizontal overflow** at 375 / 768 / 1024 / 1440, light and dark:
  `scrollWidth - clientWidth = 0` at every one.
- **`dir` and `lang` on `<html>`**: `ur → dir=rtl lang=ur`, `hi → dir=ltr
  lang=hi`. Rule 15's "dir goes on `<html>`, never on a wrapper" holds.
- **Tab order** as above.
- **Contrast was not measured.** Two attempts to compute it in-page returned
  values that were obviously wrong (21:1 for every element, which is
  black-on-white), because the harness could not resolve the computed
  `oklch()` colours reliably. Rather than publish a number that is not a
  measurement, it is left unmeasured and stated as such.

## Every list in the product spoke English

The `/login` findings sent me looking for the same shape elsewhere, and the
DataTable primitive — the one on roughly twenty list screens — had **no
translated string in it at all**. There were no `table.*` keys in the
catalogue, so nothing had ever been missed; the strings were simply written in
place:

```
No results · Showing 1–25 of 412 · Rows per page · Page 1 of 3
First page · Previous page · Next page · Last page
Search… · Clear search · Saved views · No saved views yet · Name this view
Save · Export · Columns · Nothing here yet · Couldn't load this data
Something went wrong on our end · Try again · Select all rows on this page
```

Twenty-six keys later, verified in Urdu against a running build: the footer
reads *کوئی نتیجہ نہیں*, *فی صفحہ سطریں*, *صفحہ ۱ / ۱*, and the pager arrows
mirror to the reading direction.

### The footer contradicted the table above it

While a page is in flight `totalCount` is 0, so the footer asserted **"No
results"** underneath a loading skeleton — the table says *loading*, the line
beneath says *there is nothing*, and the sentence is louder than the animation.
`aria-live="polite"` read it out, too. `DataTablePagination` now takes
`isLoading` and says so instead.

### A date is not an ISO string

The academic-years cards rendered `2026-04-01 — 2027-03-31` — the value the
database returns, not a date anybody reads. They go through
`src/lib/i18n/format.ts` now: *01 اپریل، 2025 — 31 مارچ، 2026*.

That fix had a much larger sibling, and it is now done: **42 raw
`toLocaleDateString` / `toLocaleTimeString` / `toLocaleString` calls across 30
files, 40 of them with a hardcoded `"en-IN"` — 0 now.** Rule 15 forbids exactly
that (*"it works for the first customer"*), and the ones that passed `undefined`
were formatting in the **browser's** locale rather than the reader's, which is
the same bug with a different tell.

Four shapes came up, and the third is the one worth knowing:

- **A client component** destructures the bound formatter — `const { formatDate
  } = useI18n()` — and every existing call site keeps its name and its
  arguments. Deleting the module-scope helper above it is the whole edit.
- **A server component** takes `const locale = await getLocale()` and calls
  `formatDate(value, locale)`.
- **A module-scope column array cannot hold either**, because a hook has no
  component to belong to out there. `invoiceColumns(formatDate)` is a factory
  the component calls inside `useMemo`; `formatRange` and `selectColumn` take
  the formatter and the labels as parameters for the same reason. That is the
  general answer whenever the thing needing a locale is built before render.
- **A shared component rendered from a Server Component takes the locale as a
  prop.** `ReportCardSheet` is rendered from two of them, so `useI18n()` would
  throw; it defaults to `en` rather than failing on a document somebody is about
  to hand to a family.

`formatMonth` moved out of `validations/hr.ts` and into `lib/i18n/format.ts`
alongside a new `formatDateTime`, because a formatter that takes a locale
belongs with the other formatters rather than in a module's validation file.

### Six copies of the money formatter, under four names

`formatMoney` in `fees-display`, `hr` and `inventory`; `formatAmount` in
`accounts`; `formatFare` in `transport` and `hostel`. Six functions, 91 call
sites, each building `new Intl.NumberFormat("en-IN", …)` with slightly
different options:

| copies | options |
|---|---|
| `fees-display`, `hr` | `maximumFractionDigits: 2` |
| `inventory`, `transport`, `hostel` | `minimumFractionDigits: 2` |
| `accounts` | both |

**Measured before deleting them: all three produce identical output** for
`1500`, `1500.005`, `1500.5`, `0` and `1234567.891`. That is precisely why
nobody noticed there were six — they agreed, so the cost was the one
`CLAUDE.md` already names about `library.fine_per_day`: changing it means
finding six copies, and the seventh reader writes their own.

The **guards** did not agree, and that difference was visible:

```
formatMoney("")    -> ₹0.00     (fees-display, hr, accounts)
formatMoney("  ")  -> ₹0.00
formatMoney("abc") -> ₹NaN
```

An untouched form field submits `""`. Three of the six copies turned *no value*
into **zero rupees** — the same confusion this codebase calls out about a
collection rate being null rather than 0 before anything is billed. The single
implementation returns `—` for all three, which is the stricter of the two
behaviours rather than a new one.

And the locale, which is what the sweep was for:

| | `12,34,567.89` |
|---|---|
| `en-IN` | ₹12,34,567.89 |
| `hi-IN` | ₹12,34,567.89 |
| `ur-PK` | **₹1,234,567.89** |

That is the entire visible behaviour change: an Urdu reader's digits stop being
grouped in lakhs. The rupee does not move — rule 15 says currency is a fact
about the money, not about the reader — and `tests/i18n/money.test.ts` pins
that, the two-decimal rule, the grouping per locale, and the `—`.

The two accounts wrappers that add domain meaning — `formatColumn` (a dash for
zero in a ledger column) and `formatBalance` (brackets for a negative) — kept
their names and gained a `locale` parameter. Deleting a helper that says
something is not the same as deleting a duplicate that says nothing.

## The shape of what is left

| | |
|---|---|
| screens under `src/app/(app)` | 160 `.tsx` files |
| of those, using the message catalogue at all | **53** |

The shared chrome is translated now. The module copy — every heading, every
empty state, every button on every screen — is not, and a Hindi reader gets an
English application with a translated frame around it. Naming that with a
number is more useful than another round of keys, because it says how big the
job is rather than implying it is nearly done.

## What this pass could not see

Every screen behind the login. The staff roster, the fee counter, the register,
the dashboard — all of them are reasoned about from their code in this
repository and none has been rendered here. That is worth saying plainly,
because "the UI was reviewed" and "one page of the UI was reviewed with a
browser" are different claims.

---

## The module copy, and the 44 helpers that are half of it

The chrome is translated: the sidebar, the data table, the login page, the theme
toggle, the skip link. Behind it are twenty-five modules of English.

Counted rather than estimated, over the twelve screens a guardian can reach:

```
/                        15 strings      /fees/family          0  (translated)
/timetable               40              /reports             23
/attendance/leave        21              /notifications       16
/homework                71              /notices              9  (translated)
/study-material          24              /library/books       29
/report-card              7              /settings/language    1  (translated)
                                         ---------------------------
                                         238 distinct strings
```

But 238 loose strings is the wrong shape of the problem, and finding the right
one is what makes this tractable:

> **44 `*Label` helpers, in 12 modules, called from 95 places in 57 files.**

Those are the shared half. `channelLabel` is on nine screens; `periodLabel` on
seven; `decisionLabel` on five. One edit reaches every screen that renders that
badge, which is not true of a heading.

Three things the count turned up:

- **The import-resolved number is 95, not the 170 a plain grep gives.** Three
  helper *names* mean different things in different modules — `statusLabel` in
  four (attendance, concessions, notifications, student-leave), `kindLabel` in
  four (certificates, concessions, schedules, student-leave), `periodLabel` in
  two — so a grep by name counts each module's call sites against every module's
  helper. The same `formatMoney`-under-four-names shape this document already
  recorded once, one layer along.
- **`CATEGORY_LABEL` was exported and had no caller.** A `Record` beside the
  function that read it, public, unused — the rule-15 lesson again: a correct
  string nobody renders is not a feature. It went with the rewrite.
- **A helper cannot import the catalogue.** `notices.ts` already imports Zod,
  and a label helper that pulled the message catalogue in behind it would undo
  the `fees-display.ts` split. So the translator arrives as a **parameter**, and
  `Translator` is imported as a *type* — erased at build.

### The shape, settled once

Rule 15 already decided this for the formatter version: *"a wrapper that adds
domain meaning keeps its name and gains a `locale` parameter"*. A label needs a
lookup rather than a computation, so it gains a `Translator`:

```ts
export function categoryLabel(category: string, t: Translator): string {
  return NOTICE_CATEGORIES.includes(category as NoticeCategory)
    ? t(`notices.category.${category}` as MessageKey)
    : category;
}
```

Every call site keeps the name it had and gains one argument — `getT()` in a
Server Component, `useT()` in a client one.

**The fallback is the value, not the key.** `createTranslator` returns the key
for an unknown one, which is right for a missing translation and wrong here: a
category the catalogue has not heard of would render
`notices.category.staff_only` on a badge, where the word the database stored is
strictly better. The membership check is what makes the difference, and the test
pins both halves.

### `/notices` is the first module through it

Chosen because rule 10 makes it the screen a family comes back to — *"nothing to
come back to in March to check what the circular said"* — and because it is
small enough to do completely: 9 strings, 6 category names, one helper, three
call sites, three locales. The board, the notice itself and the manage screen
all read the same catalogue now.

### The guard is a floor, run backwards

`tests/i18n/label-helpers.test.ts` mirrors `i18n.test.ts`'s per-locale floor and
points the other way: a floor says how much of the **catalogue** exists, this
says how much of the **interface** reaches it.

- every name in `LOCALE_AWARE` must still take a `Translator` — so a conversion
  cannot be quietly undone;
- the number that still hardcode English (**43**) may shrink and never grow — so
  a new helper written the old way fails the test.

Same bargain as the coverage floor, and the same reason: the only way either can
fail is that somebody's work was undone.

### The family batch: nine helpers, 34 call sites, and the second consumer

`/notices` established the shape. This is the batch a **family** actually reads,
converted together because a badge and its picker on one screen must not be in
two languages:

| module | helpers |
|---|---|
| attendance | `statusLabel` |
| student-leave | `kindLabel`, `statusLabel` |
| exams | `examKindLabel`, `resultLabel` |
| homework | `submissionStatusLabel`, `materialKindLabel` |
| fees-display | `entryTypeLabel`, `methodLabel` |

Nine helpers, **34 call sites**, 47 catalogue keys in three languages. Transport
was deliberately left out of this pass.

**The second consumer is what made it worth doing as a batch.** A label lives on
the constant, so it has two readers — the badge helper and the `<Select>` that
lists every value — and measured before starting, `.label` was rendered directly
in 3 files for `PAYMENT_METHODS`, 5 for `CHANNELS`, 2 each for
`ATTENDANCE_STATUSES` and `EXAM_KINDS`. Converting the helper alone would have
put the same value on one screen in two languages. `optionsFor(values, prefix,
t)` is the other half, and the six direct renders now go through it.

Two of those six were **module-scope constants** —
`const methodOptions = PAYMENT_METHODS.map(…)` in the fee counter and the fee
dialogs. That is rule 15's third shape, already named in the formatter pass:
*"anything built before render takes the formatter as a parameter"*. A list
built before render has no component for a hook to belong to.

### An English frame with a translated word in it is still English

`attendance-marker.tsx` announced each mark to a screen reader as
`` `${name} marked ${statusLabel(status, t)}` `` — an English sentence with one
translated word dropped into the middle. Rendered in Urdu that is the login
page's full-stop problem again, and this one is *read aloud*. The sentence is
the unit: `attendance.marked` is `"{name} marked {status}"`, and the frame is
translated with the word.

### What it costs, measured

| route | before | after |
|---|---|---|
| `/fees/daybook` | 4.30 kB / 190 kB | 4.43 kB / **192 kB** |
| `/attendance` | 7.79 kB / 211 kB | 7.91 kB / **213 kB** |
| `/academics` (untouched) | 225 kB | **227 kB** |
| `/checks`, `/certificates` (Server Components only) | 107 kB | **107 kB** |

Neither number is the `labelFor` import. The ~0.13 kB per touched route is call
sites gaining an argument; the **2 kB is the catalogue itself**, ~50 keys in
three languages, paid equally by every client route — `/academics` moved the
same 2 kB without being edited, and the Server-Component-only routes did not
move at all.

That is the bargain `i18n-provider` already states: the catalogues travel in the
bundle because the alternative is *"a screen that renders in English and then
flickers into Hindi"*. Worth writing down as a number rather than leaving as an
assumption — the earlier draft of the `fees-display.ts` comment claimed
`/fees/daybook` was "unchanged at its previous size", which the build disproved.

**43 → 35** helpers still hardcoding English, and the floor moved with it.
