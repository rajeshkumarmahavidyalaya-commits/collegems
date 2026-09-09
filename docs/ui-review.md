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

That fix has a much larger sibling, measured and **not** done here: **42 raw
`toLocaleDateString` / `toLocaleTimeString` calls across 30 files, 40 of them
with a hardcoded `"en-IN"`.** Rule 15 forbids exactly that — *"it works for the
first customer"* — and the rest pass `undefined`, which formats in the
*browser's* locale rather than the reader's. It is a mechanical sweep across
thirty files and belongs in its own change, with its own before-and-after
count.

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
