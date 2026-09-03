# Report cards, rank and remarks (Phase 3.2)

Phase 3.1 answered *what did this student score*. A report card asks three more
questions, and none of them is answerable from the `marks` table:

| Question | What it needs |
|---|---|
| Where did she come in the class? | a **rank**, which is a fact about the cohort |
| What does her teacher say? | a **remark**, written by a person |
| How often was she here? | an **attendance summary**, rolled up from periods to days |

Migrations `0077`–`0082`.

---

## Rank is a fact about the cohort, not about the row

This is the sentence the whole module turns on, and it has three consequences.

**It cannot be computed by the caller.** `exams_result_sheet` is
`SECURITY INVOKER`, so a teacher sees only the sections they teach. A rank taken
over the rows the caller happens to see is a confident wrong number — *fourth of
eleven*, when the class level has ninety. So `exams_ranking` is
`SECURITY DEFINER`: it computes over the cohort or not at all. Nothing leaks by
doing so, because staff already read `exam_results` tenant-wide.

Verified on the demo tenant: a teacher with no sections gets **0** rows from
`exams_result_sheet` and the full **301** from `exams_ranking`.

**It cannot be computed at read time.** A card handed to a parent in March must
still read "4th of 38" in December, after a transfer-out has shrunk the cohort.
So the rank is frozen into `exam_results` by `exams_publish`, in the same
statement as the marks, under the same `rules_snapshot`. The denominator is
frozen with it — `cohort_size` — because *a rank without the size of the cohort
it was taken over is the single most misread number on a report card*.

**It cannot be a hardcoded rule.** Ranking is exactly the kind of thing schools
disagree about, so it is a key in the rules document (CLAUDE.md rule 12):

```json
"rank": { "scope": "section", "method": "competition", "include": "all" }
```

| Key | Values | Meaning |
|---|---|---|
| `scope` | `section` · `class_level` · `school` | which cohort the position is taken over |
| `method` | `competition` (1, 2, 2, 4) · `dense` (1, 2, 2, 3) | how a tie is handled |
| `include` | `all` · `passed` | whether a failed result takes a position |

**A missing `rank` key means the school does not rank.** That is the
conservative reading and not a hypothetical one: several boards have abolished
class rank outright, and a card that invents one is worse than a card without
one. `exam_results.rank_in_cohort` is nullable, and a check constraint keeps the
pair coherent — null with null, or *n* of *m* with `1 ≤ n ≤ m`, never 40th of 38.

An unknown scope also means "do not rank" — the safe default — and
`grading_scheme_problems()` says so out loud, because a misspelt scope that
silently stops ranking is baffling to discover on a printed card.

All four modes verified live on 301 students:

| Rules | Result |
|---|---|
| `scope: section` | 301 ranked, 12 cohorts, exactly 12 firsts, tie at 67.429% → **7, 7, 9** |
| `scope: class_level` | 301 ranked, cohorts of 51, 7 firsts |
| `scope: school`, `dense`, `passed` | 252 ranked (49 non-passing excluded), highest rank 135 of 252 |
| no `rank` key | 0 ranked |
| `scope: "nonsense"` | 0 ranked, and the critic explains why |

---

## A remark freezes at publish, and the freeze is a foreign key

`exam_remarks` is one class-teacher sentence per student per exam. It must
freeze when the card goes home — a remark that can be edited afterwards is a
remark the school cannot stand behind — and the freeze is the CLAUDE.md rule 4
device, in its second use after `payslips`:

```sql
exam_status text not null default 'draft',

constraint exam_remarks_exam_fkey
  foreign key (tenant_id, exam_id, exam_status)
  references public.exams (tenant_id, id, status)
  on update cascade
```

…and the write policies simply require `exam_status = 'draft'`. Publishing stays
**one UPDATE on `exams`**; the cascade rewrites every remark, and from that
instant no write policy matches. No revoke, no trigger, no
`if status = 'published' then raise` in five places.

Unpublishing cascades back to `draft` and reopens them, which is the only way to
fix a typo — and it shows up in `audit_log` as an unpublish/republish pair,
exactly as a correction should.

Proven on the demo: a direct `update` on a published remark matches **0 rows**,
and `exams_set_remark` refuses with *"These results are published, so the
remarks are frozen. Unpublish the exam to change them."* — the message exists
because a raw policy failure is not something to show a class teacher.

**A remark is the class teacher's, not any teacher's.** Marks use the finer
"teacher of this subject in this section" rule, because a mark belongs to a
paper. A remark belongs to the child, and the person who knows the child is the
one who takes their register every morning.

---

## Attendance: the bug found by reading a real card

The first version computed the attendance summary at read time, cut off at the
exam's `ends_on`. The demo card came back saying **"0 of 0 days"** — the register
starts on 5 August and the exam ended on the 3rd.

The visible half was easy: cutting at `ends_on` answers *attendance during the
exam*, which is not the question a report card asks. A card reports the term.

The invisible half was the real bug. **The number moved.** Every other figure on
the card is frozen at publish precisely so a reprint matches the original;
attendance was the one that was not, and it is the number a parent is most
likely to query. It now freezes into `exam_results.attendance` with its own
cut-off date, because "172 of 180" means nothing without saying up to when.

Rolling a period-level register into days needs a rule for a day whose periods
disagree, and the rule is **worst first**: absent beats late beats excused beats
present. A child who missed two periods was not present all day, and a card that
says otherwise is wrong in the direction a parent notices.

The percentage counts a late arrival as attended and an excused absence as not.
That is a reading, written down in `attendancePercent` rather than assumed — and
if a school disagrees it becomes a rules key, not a patch.

---

## Two sources, never mixed

`exams_report_cards` returns one `jsonb` document per student, and chooses its
source from the exam's status:

- **published** → `exam_results`, exactly as frozen. Rank, attendance, marks and
  the rules that produced them all came out of the same statement.
- **draft** → computed live, staff only, stamped `provisional: true`, and with
  **no rank at all**. Ranks are written by publish; a provisional position that
  moves when one more paper is marked is a number nobody should read.

The document is assembled in Postgres rather than joined together in the app,
for the reason every read model here is: the thing that prints the card and the
thing that froze it must not be free to disagree.

A card that does not parse is **not rendered** (`parseCard` returns null and the
screen says how many were dropped). Half a report card is worse than none,
because a parent cannot tell which half is missing.

---

## Screens

| Route | Who | What |
|---|---|---|
| `/exams/[examId]/report-cards?section=` | staff | a class's cards, on screen and on paper |
| `/exams/[examId]/remarks?section=` | class teacher, admin | the whole class's remarks on one screen |
| `/report-card` | parent, student | every published result for their own children |
| `/report-card/[studentId]/[examId]` | parent, student | one card |

Cards print a class at a time, deliberately: a school-wide run is unbounded work
and belongs in `jobs` (rule 7). The class is in the URL, so a printed run is
reproducible and "Grade 6 B's cards" is a link a head teacher can send.

**Printing is the browser's own dialog, and that is honest.** Rendering a PDF is
queued work that is not built; a button implying otherwise would be the
dishonest kind of feature. What is real is the stylesheet: `data-print="page"`
puts one child on one sheet, and the last card does not eject a blank one.

---

## Permissions

`exams.view` already covered reading marks, and a family's access to their own
card is RLS rather than the matrix. Two codes draw lines RLS cannot:

- **`exams.remark`** — writing the sentence. RLS restricts it to the class
  teacher; this is how a school that does not want remarks at all turns them off
  for everybody without editing a policy.
- **`exams.publish`** — freezing results. `exams_publish` already refuses
  non-admins; this is what lets the button say so before it is pressed.

`exams_may_see_student()` is the one definer helper the module adds: staff with
`exams.view` may see any child in the tenant, a student only themselves, a
guardian only their own. The card functions are definer, so they have to ask it
themselves rather than leaning on RLS.

---

## Not built

- **A PDF.** Queued work, per rule 7. The print stylesheet is the answer today.
- **A school crest, address or principal's signature block.** `tenants` carries
  a name and nothing else; adding branding is a settings module, not this one.
- **Consolidated cards** across several exams in a session (a "final" card that
  aggregates the unit tests and the annual). That needs a weighting policy of
  its own and is a rules document, not a query.
- **Co-scholastic grades** — conduct, punctuality, activities. Real cards carry
  them; they are `exam_components`-shaped work and are recorded as a gap.
