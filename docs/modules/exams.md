# Exams and grading (Phase 3.1)

The single most common way a school ERP fails its second customer is hardcoding
the first customer's grading rules. "Best five of six", "grace up to five marks
in one subject", "an additional subject can replace a failed compulsory one" —
every school has a different combination, and every one of them is an
`if`-statement somebody wrote for one school in 2019.

So none of it is code. `grading_schemes.rules` is JSONB and the engine evaluates
it. A school whose rules differ is a **row**, not a release.

Migrations `0046`–`0049`.

---

## What is stored and what is computed

```
marks          raw facts. What the student scored. Nothing derived.
exam_results   the frozen answer, written once at publish.
```

Between those two, *everything* — grace, best-of-N, optional-subject
substitution, the aggregate, the grade — is computed on demand while the exam is
a draft. That is what lets a school change a scheme and watch the whole cohort
move. Publishing freezes it, because a report card handed to a parent must not
silently change when somebody edits a grade band two years later.

Same instinct as the fees ledger: derived while it is provisional, immutable
once it matters.

**Grace marks are deliberately not a column.** Grace is a rule, not a fact.
Storing it per row would mean the same student's grace changes meaning when the
scheme changes, and two sources of truth for "why did this 32 become a pass".

---

## The rules document

```json
{
  "grades": [
    {"code":"A1","min_percent":91,"point":10,"description":"Outstanding"},
    {"code":"E", "min_percent":0, "point":0, "is_fail":true}
  ],
  "pass":      {"aggregate_min_percent": 33},
  "grace":     {"max_marks": 5, "max_subjects": 1},
  "aggregate": {"method": "weighted"},
  "optional_subject": {"replaces_worst": true, "replaces_absent": false}
}
```

Every key is optional. An empty `{}` gives a straight weighted mean, no grace,
no substitution and no grade — **a coherent scheme, not an error**, and there is
a test asserting exactly that.

### Evaluation order, which is the part that matters

1. **Raw marks.** Absent counts as zero; not-yet-entered also counts as zero but
   makes the whole result `incomplete`.
2. **Grace.** Papers short of their pass mark by no more than `grace.max_marks`
   get exactly the marks they need — **cheapest gap first**, for at most
   `grace.max_subjects` papers. Cheapest-first is deliberate: it converts the
   most failures for the allowance, which is what a school means by grace.
3. **Per-subject pass**, using the graced marks.
4. **Optional substitution.** Where `optional_subject.replaces_worst` is set,
   each still-failed compulsory paper (worst first) is dropped in favour of a
   passed optional paper (best first), one for one.
5. **Best-of-N**, if `aggregate.method` is `best_of`: keep the top N of what
   survived step 4.
6. **Aggregate** over the counted papers, weighted by `exam_subjects.weight`.
7. **Grade**: the highest band whose `min_percent` the aggregate reaches.
8. **Overall**: `incomplete` if any counted paper is unmarked; otherwise `fail`
   if any counted paper failed or the aggregate is under
   `pass.aggregate_min_percent`; otherwise `pass`.

Steps 2-before-3 and 4-before-5 are the two schools argue about, so each is
pinned to an exact number in `tests/exams/grading-engine.test.ts` rather than
described in a comment.

### The demonstration

The demo seed ships **two** schemes over the same marks, because one scheme
demonstrates nothing — it is indistinguishable from hardcoded logic. For one
student in the demo cohort:

| Scheme | Counted | Total | Percentage | Grade |
|---|---|---|---|---|
| Standard (grace, substitution) | 7 subjects | 350 / 700 | 50.0% | C2 |
| Best five of six | 5 subjects | 277 / 500 | 55.4% | C1 |

Not one mark differs between those two rows.

---

## Two bugs the demo cohort surfaced

Both were found by reading the numbers, not the code: 49 students had an absence
and only **4** of those absences counted against anyone.

### An unmarked paper was being substituted away (fixed in `0049`)

`passed` is false for a paper with no mark, because a paper with no mark has not
been passed. The substitution step read that as "a failed compulsory subject"
and replaced it with the optional one — so the unmarked paper left the counted
set, `subjects_unmarked` fell to zero, and the student was reported as having
**passed** an exam one of whose papers nobody had marked.

Reproduced by deleting a single mark row: `result` went from `incomplete` to
`pass`, with `subjects_unmarked: 0`.

The fix is that only a *resolved* paper — one with a mark, or one recorded as an
absence — can be substituted.

### Whether an absence may be substituted is the school's decision

An absent paper is a failed paper as far as the aggregate is concerned, so the
substitution step let the additional subject cover it. That is a defensible
school policy and emphatically not a universal one: most schools will not let a
pupil skip a paper and have art stand in for it.

So it became a rule — `optional_subject.replaces_absent`, defaulting to
**false**. The conservative default is load-bearing: a school that wants the
lenient behaviour will say so, whereas a school that gets it by accident will not
notice until a parent asks why their child never sat science and passed anyway.

**This is the shape the whole module is built for.** The rule that was wrong was
wrong in a JSON document, so fixing it for one school is a row and fixing it for
everybody is one migration — not a release branch per customer.

---

## A CHECK against another table's value

Migration `0040` used a generated column and a composite foreign key to make "a
lesson period, not a break" declarative. `marks` needed the same trick
generalised from a boolean to a **value**: a mark may not exceed
`exam_subjects.max_marks`, and a CHECK cannot reach another table.

```sql
max_marks numeric(6,2) not null,           -- denormalised onto the row
constraint marks_within_max_chk
  check (marks_obtained is null or marks_obtained <= max_marks),
constraint marks_exam_subject_fkey
  foreign key (tenant_id, exam_subject_id, max_marks)
  references public.exam_subjects (tenant_id, id, max_marks)
  on update cascade on delete cascade
```

The foreign key guarantees the local copy equals the parent's, so the CHECK has
something correct to compare against. `on update cascade` keeps it in step —
**and refuses to lower a paper's maximum below a mark already awarded**, because
the cascade rewrites the child and the CHECK re-evaluates. Verified against the
live database, error and all:

```
ERROR: new row for relation "marks" violates check constraint "marks_within_max_chk"
CONTEXT: SQL statement "UPDATE ONLY public.marks SET ... max_marks = $3 ..."
```

That is the correct answer, not a side effect.

---

## Authorization

**The finer-grained rule the academic structure was built to unlock.** Attendance
still uses "class teacher sees their section", because taking a register is a
whole-class act. Marking a paper is not: the mathematics teacher marks
mathematics, and has no business editing the history marks of the same class.

| Who | Marks | Results |
|---|---|---|
| Subject teacher (`section_subjects.teacher_staff_id`) | read + write their own papers | — |
| Class teacher (`sections.class_teacher_staff_id`) | read the whole section | read |
| Admin | all | publish / unpublish |
| Student / parent | read own, **only once published** | read own |

Before publication a half-marked paper is not a result, and a parent refreshing
a page watching a number change is the sort of thing that ends in a phone call.

**`exam_results` has no INSERT, UPDATE or DELETE policy for anybody.**
`exams_publish` and `exams_unpublish` are the only writers, SECURITY DEFINER
with their own admin check — the same shape as `notify_send`, and for the same
reason: a table whose whole value is being trustworthy should not be
hand-writable by the people it describes.

Publishing also locks marking. Changing the marks under a published result would
leave the frozen row disagreeing with the marks it was computed from, which is
exactly the drift freezing exists to prevent.

---

## Functions

| Function | Security | What it is for |
|---|---|---|
| `exams_subject_breakdown(exam, student?)` | invoker | The working: every paper, every rule that touched it, and why |
| `exams_result_sheet(exam, section?)` | invoker | The aggregate, live |
| `exams_mark_sheet(paper)` | invoker | One paper's column for the entry grid |
| `exams_enter_marks(paper, entries)` | invoker | One whole column, atomically, idempotent |
| `exams_publish(exam)` | **definer** | Freeze, admin-guarded |
| `exams_unpublish(exam)` | **definer** | Delete the frozen rows, audited |
| `grading_grade_for(rules, percent)` | invoker | The highest band reached |
| `grading_scheme_problems(rules)` | invoker | Criticism, in sentences |
| `exams_rules_for(exam)` | invoker | Exam's scheme → tenant default → `{}` |

`exams_subject_breakdown` returns the *working*, not just the answer. "Why is
this 61%" has to be answerable a year later, and a number with no derivation is
how a school loses an argument with a parent. It runs one pass over the whole
cohort rather than a call per student, so a result sheet for forty is one query.

**`grading_scheme_problems` is not a check constraint**, deliberately. A
half-finished scheme should be savable — an administrator building grade bands
one at a time should not be refused at every step — and a broken one should be
explainable in sentences rather than as `violates constraint
grading_schemes_rules_chk`. It runs in Postgres rather than the browser so the
thing that judges a scheme and the thing that evaluates it cannot drift apart.

---

## Screens

| Route | What |
|---|---|
| `/exams` | Exams, and the grading schemes tab with each scheme's problems listed |
| `/exams/[examId]` | Papers (with marking progress) and the live or frozen result sheet |
| `/exams/[examId]/marks/[paperId]` | The marks grid |

**The marks grid is keyboard-first, down a column.** A teacher with forty papers
in roll order wants to type `67 ⏎ 41 ⏎ 88 ⏎` without reaching for the mouse, so
Enter and the arrow keys move between rows and nothing else competes for the
keystroke. Bulk actions ("mark the rest absent", "clear") satisfy the
`marks-entry` design override's rule against single-row-only actions.

**Explicit save, not the autosave the attendance register uses.** The two
screens look similar and the difference is deliberate: a mistyped attendance
mark is a correction; a mistyped exam mark that saved itself is a number a
parent may already have seen.

Ticking "absent" clears the mark box, because the database refuses the
combination outright — better to make it impossible than to explain the
constraint violation.

---

## What is not built

- **No components within a paper.** Theory 80 + Practical 20 is currently two
  papers with weights, not one paper with two parts. That works arithmetically
  and reads wrong on a report card; a `exam_components` table is the fix.
- ~~**No report card.**~~ Built in Phase 3.2 — a per-student card with the
  class teacher's remark and an attendance line, printing one child to a sheet.
  A *PDF* is still not built and is queued work per rule 7. See
  [report-cards.md](./report-cards.md).
- ~~**No rank or class position.**~~ Built in Phase 3.2, and as predicted here
  it turned out to be scheme data rather than an assumption: `rank.scope`,
  `rank.method` and `rank.include` are keys in the rules document, a missing
  `rank` key means the school does not rank, and the position is frozen onto
  `exam_results` at publish because it is a fact about a cohort that has since
  changed.
- **No re-evaluation or supplementary exams.** A correction today means
  unpublish, fix, republish — which is audited, and is the honest workflow, but
  is not the same as a recorded re-evaluation request.
- **Nothing notifies anybody.** `exam.results_published` exists in the
  notification catalog and no code calls `notify_send` with it yet.
- **No reports.** The reporting kernel has no exam read models yet; a
  "results by class" or "subject-wise pass rate" report is a function plus a
  catalog row.
