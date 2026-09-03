# Homework and study material (Phase 4.3)

Migrations `0053`–`0056`. The first module whose value is mostly **files**,
which is why `0053` — the storage buckets and their policies — had to come
first.

```
homework                  the assignment, drafted then set for a class
  ├── homework_files       worksheets attached to the question
  └── homework_submissions one row per student, created when it is set
        └── homework_files the answer

study_material            a worksheet or a link, on its own, no deadline
```

---

## A submission exists before any file does

The obvious design is a list of uploads. It cannot answer the question a class
teacher actually asks on Tuesday morning — *who has not handed in?* — because
the absence of a row is indistinguishable from a child who was never set the
work.

So `homework_publish` creates one `pending` row per actively enrolled student,
and "not handed in" is a row with a status rather than a gap. That decision is
what makes the marking screen a register instead of an inbox.

Two consequences worth stating:

- **`collects_submissions` is a real column, not a convenience.** Homework that
  is "finish exercise 4 in your book" gets **no roll at all**. Rolling one
  anyway produces a wall of permanently-pending rows and teaches the whole
  school to ignore the screen.
- **Publishing is not idempotent, deliberately.** A second `homework_publish`
  raises *"This homework is already published"* rather than quietly topping up
  the roll. The `on conflict do nothing` underneath is there for the
  unpublish-then-republish path, not to make a double click safe.

### The gap this leaves

A student enrolled **after** the homework was set has no submission row and
never will. Un-setting and re-setting is the only way to catch them up, and it
is refused once anything has come in. This is a known gap, not a solved
problem: a trigger on `enrolments` would fix it and has not been written,
because a trigger that back-fills homework onto a mid-year arrival is a policy
decision (does a child who joins in November owe October's work?) and rule 12
says policy is data, not an `if` somebody added on a Tuesday.

---

## Why `homework_submissions` has no student UPDATE policy

This is the interesting part of the module, and it is an **absence** — so it is
easy to delete by accident.

A student must be able to change three columns on their own submission
(`status`, `submitted_at`, `note`) and must never touch two others
(`marks_obtained`, `feedback`). The reflex, correctly learned from migration
`0039`, is a policy plus a column-level grant:

```sql
revoke update on public.homework_submissions from authenticated;
grant update (status, submitted_at, note) on public.homework_submissions to authenticated;
```

**That does not work here, and the reason generalises.** A column grant is
**role-wide**, and every user of this application — student, teacher, admin
alike — is `authenticated`. The grant above would take `marks_obtained` and
`feedback` away from the teachers as well, breaking marking to protect it.

`notification_deliveries` looked identical and was not: there, *nobody except
recipients had UPDATE at all*, so narrowing the role's columns narrowed exactly
one party's rights.

So the rule is:

> A column grant separates **columns**, not **people**. When two roles need
> different column rights on the same table, the grant cannot express it —
> give the narrower role a `SECURITY DEFINER` function instead, and give it no
> policy at all.

Hence `homework_submit` and `homework_unsubmit`: definer, narrow, each setting
exactly three columns after checking `current_role_code() = 'student'` and that
the row belongs to the caller. The same shape as `notify_send`, for the same
reason. The absence of a student UPDATE policy *is* the mechanism — a future
migration that "tidies up" by adding one hands every child a mark sheet.

`homework_grade` is `SECURITY INVOKER`, because teachers and admins do have a
policy that covers the whole row, and RLS is the better boundary wherever it
can carry the rule.

---

## The maximum is enforced by a foreign key, not by code

`homework_submissions.max_marks` is a denormalised copy of the parent's, held
equal to it by a composite key:

```sql
constraint homework_submissions_homework_fkey
  foreign key (tenant_id, homework_id, max_marks)
  references public.homework (tenant_id, id, max_marks)
  on update cascade
```

with a plain `CHECK (marks_obtained <= max_marks)` beside it. Same trick as
`marks` against `exam_subjects` — a CHECK cannot reach another table, so the
value is brought within reach.

`on update cascade` does the second half of the job: lowering a homework's
maximum below a mark already awarded rewrites the child and the CHECK
re-evaluates, so the update is refused. Verified live — dropping a 20-mark
exercise to 10 with an 18 already given fails with
`homework_submissions_marks_chk`. **That refusal is the correct answer, not a
side effect**, and `saveHomework` translates the `23514` into a sentence about
the mark rather than the constraint.

---

## Storage: two independent halves, neither sufficient alone

Rule 8, finally exercised. The split is worth stating once because every later
upload copies it:

| | sees | enforces |
|---|---|---|
| **Storage RLS** (`storage.objects`) | the object path, nothing else | the first path segment is the caller's tenant |
| **The server action** | `public`, through the caller's own JWT | the row-level question — is this the student's own submission? |

`public.storage_object_tenant_matches()` is the storage half. It lives in
`public` because `storage` is not a schema this project may create functions in
— policies on `storage.objects` are creatable, functions in `storage` are not.

Paths are `{tenant_id}/{owner_id}/{uuid}-{name}`:

- The **first segment is load-bearing** — it is the whole of the storage-side
  security, which is why `safeFileName()` rebuilds the name rather than trusting
  it. A `../` in a filename would move the object out from under the prefix that
  describes it.
- The **uuid** stops two people uploading `answers.jpg` from colliding, and
  makes the object unguessable — which matters because a signed URL is
  bearer-only once issued.
- Everything below the tenant is **addressing, not security**. A person who
  guesses a classmate's submission id inside their own school is stopped by the
  server action, not by the path.

**A download is never a plain `href`.** The button asks the server for a signed
URL, and `downloadUrlFor` reads the row back through RLS first — if the select
returns nothing, no signature is issued. The click *is* the permission check.
A link rendered into the page would have had to be signed before anyone asked
for it, which is the same as publishing it.

Ten-minute expiry: long enough to click, short enough that a link pasted into a
group chat stops working before it travels far.

### Orphans have a direction

The object goes up **first** and the row **second**, and a failed insert takes
the object back down. On delete the order reverses — objects first, while the
paths are still readable, because `on delete cascade` would otherwise take the
`homework_files` rows and leave files nobody can ever name again.

An orphaned object costs a few bytes nobody sees. An orphaned row is a broken
download on somebody's screen. When only one of the two can be guaranteed, it
is always the row.

### `constants.ts` vs `files.ts`

`src/lib/storage/files.ts` imports the server Supabase client, so importing it
from a client component is a build error — that is what keeps uploads
server-side, enforced rather than asserted. But an upload control has to state
the limit *before* a person picks a 40 MB file. The bucket names, size caps and
MIME lists therefore live in `src/lib/storage/constants.ts`, which has no
server imports, and `files.ts` re-exports them so callers have one import to
remember. One definition, both halves.

---

## Study material is deliberately flatter

One item is one thing — a PDF, or a link to a recording. Several files means
several items, which is also how a person thinks about a reading list.

- `section_id` null means **the whole school**; `subject_id` null means
  **general**. Both are answers, not omissions, and the UI renders them as words
  rather than a blank cell.
- `study_material_source_chk` makes it a file **or** a link, never both and
  never neither. An item that is neither is a title with nothing behind it,
  which is worse than no item. Verified: both violations are refused.
- The schema in `src/lib/validations/homework.ts` can only see half of that —
  a `File` is on the `FormData`, not in the parsed object — so the server action
  completes the check and returns a sentence about the field the person left
  empty rather than a constraint name.

---

## One route, two screens

`/homework` renders a teacher's list of what they set, or a family's list of
what they have to do, from the same address. Giving each its own URL would mean
telling a parent to visit a different page from their child, which is the sort
of thing that gets a product quietly abandoned.

`homework_for_student(p_student_id, p_include_done)` defaults `p_student_id`
**inside the function** to the caller's own record, so a student passes nothing
and cannot point it at a classmate. A parent names a child, and the enrolment
join under RLS decides whether that was one of theirs — the `?student=` in the
URL is a convenience, not a key.

`is_late` and `is_overdue` are **derived, never stored**. A due date can move,
and a stored flag would then be a fact about a deadline that no longer exists.

---

## What is not built

- **No notification on publish.** Setting homework does not call `notify_send`
  yet. It should, and it is one line — the reason it is not there is that a
  school setting eight pieces of homework on a Monday would send eight
  notifications to every parent, and batching that is a policy question (rule
  12) rather than an omission to patch over.
- **Staff cannot hand anything in.** `homework_submissions.student_id` is
  `not null`, which is correct — homework is set to children.
- **No plagiarism, no rubric, no per-question marking.** A rubric is the
  natural next rules-as-data document if a school asks.
- **No bulk download of a class's submissions.** That is unbounded work and
  belongs in `jobs` per rule 7, not in a request handler.

---

## Verification

The pure half — what a teacher may type, what a filename may contain, what a
due date means to a person — is in `tests/homework/homework-shapes.test.ts`
(27 assertions, runs anywhere).

The database half is `tests/homework/homework-flow.test.ts`, and the four
homework tables are in the cross-tenant suite. Every guard in it was also
driven directly against the live database while the module was written:

| Property | Result |
|---|---|
| publish creates one pending row per enrolment | 25 rows, `max_marks` propagated to all 25 |
| a pending row never carries a time | 25 of 25 |
| a second publish | refused — *"This homework is already published"* |
| grading 25 out of 20 | refused — *"A mark must be between 0 and 20.00"* |
| grading 18 out of 20 | `returned`, with `graded_at` set |
| lowering the maximum to 10 afterwards | refused by the cascade |
| unpublish after work came in | refused — *"1 piece of work has already been handed in…"* |
| an admin calling `homework_submit` | refused — *"Only a student can hand work in"* |
| study material with neither a file nor a link | refused |
| study material with both | refused |

**A caveat on what could not be exercised:** the demo database has only the two
admin logins. Student, parent and teacher RLS on these tables is asserted
structurally — the policies exist and the student UPDATE policy verifiably does
not — but no student has signed in to prove it end to end. The first real
student account is the test that matters here.
