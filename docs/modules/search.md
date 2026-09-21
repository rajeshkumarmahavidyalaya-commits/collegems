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

## The other five, and the picker that could reach twenty of three hundred

`0258` closed three of the eight sites `0223` left. Reading the remaining five
together says they are **one** finding rather than five:

| | |
|---|---|
| `fees/actions.ts` `searchStudentsForCounter` | byte-identical |
| `transport/actions.ts` `searchStudentsForTransport` | to each |
| `hostel/actions.ts` `searchStudentsForHostel` | other |
| `certificates/actions.ts` `searchStudents` | different, and worse |
| `library/actions.ts` `listBooks` | a list, not a picker |

**Four of them are "find a student by admission number or name", written four
times** — `formatMoney` under four names, one layer along, and rule 6's
sentence about billing applies unchanged: *one definition, consulted by
everything.* Three of the four also made **two** round trips per keystroke,
because `students.admission_number` and `people.first_name` are on different
tables and PostgREST was asked twice.

`public.student_search(p_query, p_limit)` (migration `0259`) is that one
definition, and the three module-specific hydrations — a fee balance, a bus
assignment, a hostel bed — stay where they were.

### The fourth was not a copy

`certificates.searchStudents` had a *different* filter string, one reaching an
embedded table from a top-level `or` — and **nothing ever passed it a term.**
`/certificates/issue` called `searchStudents("")`, so that branch was
unreachable and what shipped was the fallback under it:

```ts
.order("admission_number").limit(20)
```

rendered into a flat `<Select>`. Measured on this college: **20 of 302
students** could be issued a certificate, in admission-number order, and the
other 282 were not in the list at all.

> **A search parameter no caller passes is not a search.** It reads like one in
> the signature and like a bounded list on the screen, and only counting the
> rows tells them apart.

The comment twenty lines below it explains that the *staff* picker deliberately
takes no term because "a college's staff is bounded by the size of a college,
so the whole list fits in a `<Select>`" — true of **15** employees and false of
**302** students, in a paragraph naming the very defect above it. Staff keep
their `<Select>`; students get a type-ahead over `student_search`, with
`shouldFilter={false}` so cmdk does not re-filter an answer the database
already narrowed.

### The library one is a list, so it is shaped differently

`listBooks` pages, sorts and counts, and `fees_student_balances` already
established the idiom: PostgREST applies `.order()`, `.range()` and
`count: "exact"` to a set-returning function exactly as it does to a table. So
`library_books` takes the two filters and the whitelisted sort column stays in
TypeScript — **that one is a client-supplied identifier, and no bound parameter
can carry it.**

A set-returning function is an optimisation fence (rule 7), so it runs to
completion before the range applies. That is not a change: `count: "exact"`
already paid for a full pass.

---

## The guard is the sweep, not the module

`0223` fixed one site and guarded **one module**, and eight more went on doing
it for thirty-six migrations.

> **A rule guarded in the module that discovered it is a rule that holds in
> that module.**

`tests/security/a-search-box-is-not-a-filter-string.test.ts` sweeps `src/`.
Deliberate exceptions live in `NOT_A_SEARCH_TERM` with a reason, and the bar is
*the argument is not text a person typed* — today that is one entry,
`homework/actions.ts`, whose `.or(filters.join(","))` is two `in.(…)` lists of
uuids this server read back a moment earlier.

Two things about building it:

- **The discriminator is what the file does, not how it spells an
  identifier.** Zod's `.or()` is a different method with the same name, and the
  first draft excluded it by checking the argument starts with `z.` — so a
  validations module importing zod under an alias was reported as a defect. **A
  guard that reports a correct file is a guard somebody switches off.** It now
  only looks at files that build a Supabase query at all.
- **Anchor to the statement.** The check that the RPCs bind their parameter
  first concatenated every migration and asserted the shape appeared
  *somewhere* — which three functions satisfy between them while any one of
  them changes freely. It reads each function's own latest body now. Verified
  by planting: four violations each fail the right check, and the aliased-Zod
  control passes.

---

## The probe contradicted a comment in the migration that shipped it

`0259` said, in its header and on the function:

> *INVOKER, so row-ownership RLS decides — a class teacher finds the children
> they teach.*

It is false. A teacher login built in a rolled-back transaction, attached as
class teacher to a section with 27 enrolments:

| table | this teacher | the college |
|---|---|---|
| `students` | **302** | 302 |
| `people` | **872** | 872 |
| `guardian_student` | **555** | 555 |
| `enrolments` | 27 | 302 |
| `attendance_records` | 500 | 6,000 |

`enrolments` and `attendance_records` are row-scoped; `students`, `people` and
`guardian_student` are **tenant-wide for every staff role**. That is rule 4's
own refinement — *the matrix does real work wherever RLS is deliberately
tenant-wide* — and it is the existing design: `0183` looked squarely at
`people` and narrowed it for **families**, keeping staff.

The sentence was easy to write because `students` carries `teachers view own
section students`, whose predicate is exactly *"children in a section I am
class teacher of"*. It is unreachable: `staff roles view students` grants a
teacher every row with no predicate, and **RLS policies are OR-ed.**

> `0249` learned that from the other end — a correct narrow policy beside an
> over-broad one is an alternative, never a restriction. The corollary it did
> not state: **the narrow policy still reads like a promise.** Two of them here
> (`students` and `people`) have been unreachable since the module shipped, and
> reading the policy list is how you come to believe otherwise.

Migration `0260` corrects both comments and **deliberately does not narrow the
policy**: a teacher reads the whole roll on the class picker, the importer, ID
cards, the fee counter and the register, and taking that away is a
security-relevant rewrite whose instrument is a probe as all six seats.

> **Write down what the probe said, not what the design intended.**

---

## The cost of the picker

Built before and after over all 108 routes: the shared bundle is **103 kB both
ways** and exactly **one route moved — `/certificates/issue`, 213 → 223 kB.**

That is Radix Popover arriving for the first time: `src/components/ui/popover.tsx`
had been a primitive nothing imported, and this is its first caller. Ten
kilobytes, on one route behind `certificates.issue`, to make 282 more children
reachable — taken deliberately rather than deferred, because the picker is the
screen's main control and not something behind an interaction (rule: *a
conditional render is not a conditional load*, and its converse — `next/dynamic`
on the thing somebody came here to use buys a spinner, not a saving).

The staff half still uses the `<Select>` it always had, so the asymmetry on the
screen is the asymmetry in the data: **15 employees, 302 students.**

---

## …and the picker I had just written was about to become the fifth copy

`0259` replaced four copies of one *query*. The **picker** went into
`issue-form.tsx`, where the next screen would have pasted it — the same mistake
one layer up, in the commit that fixed the first one. So it moved to
`src/components/people/student-picker.tsx`, and the sweep that followed found
the screens that needed it.

**Three screens loaded a roll into a flat `<Select>`**, each with a different
bound, measured against this college's **303 active students**:

| screen | what it did | who it could reach |
|---|---|---|
| `/certificates/issue` | `.order("admission_number").limit(20)` | **20 of 303** |
| `/attendance/leave` | `.limit(200)` | **200 of 303** |
| `/fees/concessions` | `.limit(500)` | 303, in one dropdown |

> **A bound nobody has reached is not a bound somebody decided.** The three are
> the same mistake at three generosities, and only the generosity differs — the
> concessions screen is correct today and silently drops children at 501.

Two things make the leave one the sharpest:

- **The truncation was invisible from the seat the screen was built for.** RLS
  scopes that read, so a guardian sees their own one or two children and a
  dropdown of two looks perfect. The 102 missing children exist only for the
  office, and they look exactly like children who are not enrolled.
- **A picker's default is decided by what the picker was given.** The dialog
  opened on `students[0]` — an arbitrary first-by-admission-number child,
  pre-selected on a form that applies for leave. That is `/timetable` defaulting
  to `sections[0]`, in a different module.

### What the fix costs, in both directions

Built before and after, all 108 routes; the shared bundle is **103 kB** either
way.

| route | JavaScript | JSON per view |
|---|---|---|
| `/fees/concessions` | **+8 kB** | **−32.0 kB** |
| `/attendance/leave` | **+8 kB** | **−21.1 kB** |
| `/certificates/issue` | +1 kB | *(already fixed)* |

The JavaScript is Radix Popover, cached after the first visit and now shared by
three routes — which is why the first route paid 10 kB and these pay 8. The JSON
is the roll, re-sent on **every view**: 32,765 bytes for 303 children, 21,619
for the 200 the leave screen asked for. So it is a correctness fix that also
gets cheaper from the second page view onward, and both halves are measured
rather than argued.

### The guard found the third one

`tests/people/one-student-picker.test.ts` was written for the two screens I knew
about and immediately named `/attendance/leave`, which I had not looked at. Four
checks, each verified by planting: no file renders a student list as
`SelectItem`s, `StudentPicker` has exactly one definition, every user imports it
rather than copying it, and the component takes its server action as a **prop**
(so it can never reach into `@/app/…` for one).

That last one is rule 8's split applied to a picker: **share the choreography,
keep the authorization with the caller.** All three callers reach
`student_search` today; a screen that must narrow the roll further — to one
section, to children with a balance — supplies a different action without the
component learning about it.

And the negative control that matters: the **staff** `<Select>` on the same
certificate form is 15 people and stays a dropdown. The bar is a *roll*, not a
list.
