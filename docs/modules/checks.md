# Needs attention — one place to ask what is wrong

**Migrations** `0188` (the catalogue and the runner), `0189` (a probe as a
teacher, and what it found). **Table** `reference.checks`.
**Function** `checks_run()`. **Screen** `/checks`.

This codebase has been writing critics for a year. `grading_scheme_problems`
started it — *"criticise the document in Postgres, not in the browser"* — and
there are now eight that take no arguments and describe the school as it
stands:

| check | what it looks for |
|---|---|
| `academics_session_problems` | what a rollover is about to leave behind |
| `student_exit_problems` | a child marked gone who is still being billed |
| `staff_exit_problems` | a leaver who still holds lessons |
| `fees_billing_conflicts` | one fee head billed from two sources |
| `concession_problems` | an award that has expired or lost its student |
| `notify_template_problems` | a template a channel cannot actually send |
| `schedule_problems` | a schedule that runs green while nothing goes out |
| `settings_problems` | configuration nobody has filled in |

Every one of them was surfaced on exactly one screen. So a school found out
that four hundred parents were getting nothing only if somebody happened to
open the schedules page, and that a departed teacher still held nineteen
lessons only if somebody opened the cover roster.

> **A critic is only worth what it costs to reach it.**

`reference.checks` is the `reference.reports` pattern applied to them: the
catalogue is data, `checks_run()` runs any of them without being edited, and
adding a ninth is one row.

---

## What is deliberately not in it

**Critics that take an argument.** `exams_problems(exam)`,
`grading_scheme_problems(rules)` and `certificate_template_problems(template)`
criticise *a document you are holding*; moving them here would mean choosing
which exam to complain about, which only the person holding it can answer. The
line is: **does this critic describe the school, or a thing?**

**The three schema guards.** `schema_guard_violations`,
`privilege_guard_violations` and `audit_guard_violations` are about the
*product* — identical for every tenant, and already the test suite's job.
Putting them on a school's screen would ask a head teacher to act on a migration
somebody forgot to write.

---

## Four states, because three of them look like nothing

A page that shows only problems cannot tell you which of these happened:

| status | means |
|---|---|
| `attention` | the check ran and found something |
| `ok` | the check ran and found nothing |
| `withheld` | the caller's role does not cover it, so it was not run |
| `error` | the check **raised**, and has therefore not passed |

The last two are the point. `withheld` is rule 11's dashboard lesson —
*absent-and-withheld* and *absent-and-clean* are different sentences and only
the server knows which applies. And `error` is the failure this whole idea
invites: one broken critic quietly turning a page green. Each critic runs in its
own block, and an exception becomes a finding of its own with the message on it.

---

## The probe that changed the design

Migration `0188` was written, applied, and looked perfect **as an
administrator** — which is exactly the warning already recorded about
`dashboard_summary` in migration `0129`. Probed as a **teacher**:

```
students.left    attention    200 rows
```

against the administrator's `ok`. Not a smaller answer: a **bigger** one, and
every row of it false.

`student_exit_problems` has a branch reading *"active but on no register"*,
built on `not exists` over `enrolments`. A teacher's RLS there is
row-ownership — they may read the children in the sections they teach and
nobody else's — so to a teacher every child in the school they do not teach has
no enrolment, and the page accused two hundred families.

> **A critic built on `not exists` can only be shown to a caller who can see
> everybody.** Under row-ownership RLS, absence and invisibility are the same
> shape.

This is the sharper half of a rule CLAUDE.md already carries. An invoker
function over row-ownership RLS *under-reports* — `substitution_gaps` telling a
teacher nobody is away. A `not exists` one **over-reports**, and a missing
sentence is a smaller harm than a false accusation.

### And the permission is not a proxy for it

The obvious fix — gate it on `students.view` — was already in place and did not
work, because three roles hold that permission and they do not all see the same
rows. Probed:

| role | `students.left` |
|---|---|
| admin | `ok` |
| accountant | `ok` — RLS on students is tenant-wide for them |
| teacher | **200 findings, all false** |

So `0189` moves it to `students.manage`, the permission a school gives to
somebody who may *act* on either branch, and `staff.left` to `staff.manage` for
the same reason before a school grants `staff.view` to a head of department and
gets the same surprise. The rule is written on the column itself.

---

## The cap says it is a cap

The same probe showed the other half: 200 is the per-check cap and nothing said
so. A truncated list that looks complete is the mistake rule 13 names about
imports — *"silently importing the first 500 of 900 children is the worst
available outcome"* — arriving here as a screen reading "200 problems" when
there may be four hundred. So a capped check emits a final line saying *"showing
the first 200; there are at least this many"*, and never a bare exact number,
because the exact one is the number it cannot honestly report.

The cap is **per check**, not overall, so one noisy critic cannot crowd out a
quiet one with something worse to say.

---

## On the demo school today

As an administrator, six checks clean and two with something to say — including
the one that had been sitting in the data for weeks and was reachable only from
the cover roster:

```
academics.session  warning  The current session 2025-2026 ended on 31 Mar 2026 …
academics.session  info     46 bus seats end with 2025-2026 and have not been renewed …
academics.session  info     13 hostel beds end with 2025-2026 and have not been renewed …
staff.left         error    Rudra Rai is marked terminated but still teaches 19 lessons,
                            leads 2 sections, holds 6 subject assignments.
```

As a teacher: seven withheld, one clean, and nothing false.

---

## What it costs, and the measurement that was wrong

One round trip answers eight questions, and it is not free. Measured on the
demo school **as an administrator, with RLS on**:

| check | ms |
|---|---|
| `fees.concessions` | 845 |
| `students.left` | 414 |
| `staff.left` | 176 |
| `communication.templates` | 118 |
| `schedules.reach` | 52 |
| `settings.filled` | 29 |
| `academics.session` | 26 |
| `fees.billing` | 9 |

`checks_run()` end to end: **849 ms first call, 692 and 659 on the next two** —
so it is steady work, not a one-off planning cost.

The first measurement of the same function said **19 ms**, and it was wrong in
the way that matters:

> It was taken from a `DO` block running as `postgres`, which **bypasses RLS
> entirely**. The 35× difference is the policies — every critic joins students,
> people and their own table, and each of those carries policies that are
> themselves function calls.

`concession_problems` costs 845 ms on a school with **zero concessions**, which
is the tell: almost none of this is rows, and all of it is being allowed to see
them.

> **Measure as the caller.** A superuser timing of an RLS-protected read is not
> a fast path — it is a different query.

---

## Adding a ninth check

One row in `reference.checks`, and four questions:

1. **Does it describe the school, or a document?** A document's critic stays
   beside its document.
2. **Does it ask what is missing?** If so, its permission must be one only a
   whole-school role holds.
3. **Where does somebody go to fix it?** `href` is required; a sentence with
   nowhere to act on it is half a critic.
4. **Which shape does it return?** `severity_message` or `problem` — declared,
   not sniffed.
