# Search, and the palette that carries it

Ctrl-K opens `CommandPalette`, which is mounted in the app shell and is
therefore on all 94 authenticated pages. It is the one control every role uses,
and it had two defects. They are the same defect twice: **a fix that landed in
one consumer and not in the other.**

---

## 1. The menu was filtered and the palette was not

`navForRole(roleCode)` has existed since the shell was built, the sidebar has
always called it, and `tests/app-shell/nav-audience.test.ts` has guarded the
`roles` lists it reads since the family-menu work. The palette imported
`NAV_GROUPS` **raw**.

Counted over the 54 entries:

| role | sidebar | palette |
|---|---|---|
| admin | 51 | 54 |
| teacher | 26 | 54 |
| accountant | 33 | 54 |
| librarian | 16 | 54 |
| parent | **10** | **54** |
| student | **10** | **54** |

So a guardian pressing Ctrl-K was offered *Payroll*, *Fee counter*, *Voucher
book*, *Delivery log*, *What each role may do* and thirty-nine more. Three of
them — *Payroll*, *Leave*, *Needs attention* — are the entries `CLAUDE.md`'s
rule 4 section describes taking away from exactly that seat, and the guard that
did it went on passing.

> **A guard on a list is not a guard on its consumers.** `nav-audience` asks
> whether somebody decided who an entry is for. It cannot ask whether every
> renderer honoured the decision.

None of this was a boundary — rule 4's first sentence is that the menu is never
the gate, and every page behind these entries checks its own permission. It was
a **claim about who the product is for**, made twice, differently, on the same
screen.

The fix is one prop: the shell already computes `navForRole(roleCode)` for the
sidebar, and hands the same object to the palette. Two callers of one filter is
where the two answers came from, so there is still exactly one call.

`tests/app-shell/nav-consumers.test.ts` is the executable half — six checks,
each verified by planting its violation and going green on revert:

| check | plant |
|---|---|
| `NAV_GROUPS` is read raw only in `nav-config.ts` | a second file imports it |
| `navForRole` has exactly two call sites | a third file calls it |
| the palette's `navGroups` prop is not optional | `NavGroup[] \| undefined` |
| the palette translates what it draws | `{item.title}` |
| a hit's path comes from `searchHitHref` | the `/library/members` shortcut |
| the component carries no route literal | *(same plant)* |

Two of the six first passed on a **faulty plant** rather than a weak check — an
import with no call, and a type widened in a way the anchor still matched. Both
were re-planted properly; the second was a genuinely weak assertion and the
regex is anchored on the closing brace now.

---

## 2. Every student and every colleague linked to the library

`globalSearch` built each result's `href`, and both the student branch and the
staff branch read:

```ts
href: `/library/members`,
```

A person searching for a child by name was taken to the library's membership
list. It is invisible in the way that matters: a link that goes *somewhere* is
not a link that errors, and the destination is a plausible-looking page.

`searchHitHref` in `src/lib/validations/search-display.ts` is the one mapping,
and the guard is rule 11's: assert the component **calls** it and carries no
route literal of its own. A check that only asserted `/students/` appears would
pass on the shortcut it exists to forbid.

**There is no permission branch in it and there must not be one.** RLS decides
what `global_search` returns, so a guardian is only ever offered their own
children, and `/students/[id]` resolves that child by id through the same
policy.

---

## 3. Five round trips, three of them filter strings

Each keystroke fired five PostgREST requests. Three built a filter **language**
out of somebody's typing:

```ts
.or(`first_name.ilike.${like},last_name.ilike.${like}`, { referencedTable: "people" })  // students
.or(`employee_code.ilike.${like},designation.ilike.${like}`)                            // staff
.or(`title.ilike.${like},author.ilike.${like}`)                                         // books
```

Migration `0223` replaced exactly this shape once, in the sibling picker, and
wrote down why: *the fix is not to escape more carefully, it is to stop
building a query out of text.* It fixed **one of nine**. These were three more.

`public.global_search(p_query, p_limit)` (migration `0258`) is `SECURITY
INVOKER`, takes the term as a bound parameter, bounds each kind, and orders
every branch with an id tiebreak — without one, the five rows a type-ahead
returns are an arbitrary five, and they change between keystrokes that did not
change the term.

### Probed

In a rolled-back transaction, with a guardian login created for the purpose —
this college has three logins and all three are administrators — and with a
book planted whose title contains the character that breaks a filter string:

| seat | term | students | staff | books |
|---|---|---|---|---|
| guardian (1 child on record) | `a` | 0 | 0 | 0 |
| guardian | `an` | **1** | **0** | 10 |
| administrator | `an` | 20 | 7 | 10 |

The guardian's row is the whole argument for `SECURITY INVOKER`: their own
child, no staff at all (there is no parent SELECT policy on `staff`), and the
college's book catalogue, which `tenant members view books` makes theirs. The
palette needed to know none of it.

And the term that used to break:

```
ADMIN  "Escher, Bach"  ->  Gödel, Escher, Bach — Hofstadter, Douglas
```

The set-up is checked before the answer is reported: the guardian is chosen
from a real `guardian_student` row, because a guardian with no children returns
zero rows and that reads exactly like a correct refusal — the seating probe's
lesson, kept.

Measured on this college: **0 of 303 people and 0 of 21 books carry a comma or
an apostrophe today.** So nothing was broken *here*, and that is worth stating
rather than dressing up — the defect is in what the code accepts, not in
today's rows, and a library whose catalogue has no `Gödel, Escher, Bach` in it
is a young library.

---

## What the function deliberately does not return

**No subtitle and no href.** *"Admission #123"* is a sentence and belongs in the
catalogue rule 15 built for sentences; a path is a fact about this application
and not about the row — rule 11's `columns[].href` decided the same thing from
the other direction. So `global_search` returns the **value** (an admission
number, a designation, an author) and `search-display.ts` assembles the words
where a translator can reach them.

That file has **no runtime imports**, on purpose: the palette is on every
authenticated page, so anything it pulls in is pulled onto all of them. Its one
import is `import type { Translator }`, which compiles away — the
`fees-display.ts` bargain, with its warning kept verbatim.

---

## The cost

Built before and after, all 108 routes: the shared bundle is **103 kB both
ways**, and **24 routes moved, every one by +1 kB** — 24 kB in total, for five
catalogue keys in three languages. The route table rounds to whole kilobytes,
so +1 kB is the reporting granularity rather than a measurement of five keys.
Nothing else moved, because the palette's own imports got *smaller*: it no
longer pulls `NAV_GROUPS` or a second Lucide icon.

---

## Still a filter string, and named rather than quietly fixed

`0258` closes three of the eight sites `0223` left. Five remain, and they are
one finding rather than five: **four of them are the same student picker,
written four times** — in `fees`, `transport`, `hostel` and `certificates`, the
first three byte-identical — and the fifth is the library list. They are named
here rather than half-fixed, because one `student_search` consulted by four
callers is a different change from four escapes.
