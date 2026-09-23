# Online tests

Migration `0274`, `/online-tests`, `/online-tests/[id]`.

Multiple-choice tests that a subject teacher sets for one class. Students sit
them in the browser against a clock, and Postgres marks each one the moment it
is handed in. Measured first: no quiz, question or attempt tables anywhere. This
was the last Phase 3b gap.

## The fact everything follows from

> **The answer key is a column of the question row, and RLS cannot restrict
> columns** (rule 4). A policy that let a student read a question would hand
> them `correct_option` with it.

So the design is about who can reach that row:

| door | who | what it shows |
|---|---|---|
| `online_test_questions`, through RLS | the course's teacher, an administrator | everything, key included |
| `online_test_start` (definer) | the enrolled student, while the test is open | prompt, options, marks, **never the key** |
| `online_test_review` (definer) | a student who sat it, **after the close**, if the teacher allows | the key and their own choice |
| `online_test_results` (definer) | the course's teacher, the class teacher, an administrator | the roster, the marks, per-question counts |

**The questions table has no student or family policy at all.** That absence is
what keeps the key hidden, and the migration says so where the policy would
otherwise be added. A migration that tidily "adds the missing select policy"
would publish the key to every child in the class.

## Two parties, two sets of rights: the `homework_submit` shape

A student must write their answers. A teacher must never have a student's mark
written by the student. Rule 4 already has the answer for two roles that need
different rights on the same row:

- **The student's writes are all definers:** `online_test_start`,
  `online_test_save` and `online_test_submit`. Each sets exactly the columns a
  sitting may set.
- **Nobody holding a JWT may write `online_test_attempts` directly.** Insert,
  update and delete are revoked, which is rule 6's stronger shape. Probed: a
  student writing `score` gets `permission denied`.

## One marker

`online_test_score` is the only place an answer is compared with the key for a
mark. `online_test_finish` freezes its result onto the sitting, with the maximum
beside it (rule 12's denominator), and `online_test_submit` goes through it.
The teacher's results use the same function to show a *provisional* mark for a
sitting that ran out without being handed in. Two graders would give two
answers (rule 11). The guard checks that exactly `online_test_score` and the
results' per-question count compare an answer with the key.

## The key freezes on publish: rule 4's device, twice

- **Questions carry the test's status** (`test_status`, held equal by the
  composite key, `on update cascade`), and every write policy requires
  `'draft'`. Publishing is one UPDATE on the test; from then on nobody can
  change a question or its key. Probed: a direct update of `correct_option`
  after publish touches **0 rows**.
- **Sittings carry it too, with `check (test_status = 'published')`.** Taking a
  started test back to draft cascades into the sitting, the CHECK fails, and
  the change is refused. That holds for a plain PostgREST UPDATE too, which a
  check in `online_test_unpublish` alone could not promise (0205). Probed:
  `23514 … online_test_attempts_test_status_check`. The function still counts
  first, so what a person actually reads is *"2 students have already started
  this test…"*.

## The clock

- **`due_at` is frozen when a sitting starts**: the duration from then, or the
  close if that comes sooner. Reopening the page does not reset it, and moving
  the close later does not lengthen a sitting already running. Probed: 30
  minutes exactly.
- **Two minutes of grace** past it for saves and the submission, for a
  network. The browser's `GRACE_MS` and the four `interval '2 minutes'` in the
  migration are pinned together by the guard.
- **A late submission is marked on what was saved in time**, and says so
  (`submitted_late`). A sitting that ran out without being handed in is marked
  the next time the student opens it, or on the results screen as provisional.
- **Reading the questions starts the clock**, so the test's page never loads
  the paper on render. Only the *Begin now* button calls `startTest`; the guard
  checks both files, because a page that loaded the paper would start the clock
  on a link prefetch.
- **Answers are saved at most every 30 seconds**, when the page is hidden, and
  on submit. Every save is an audited UPDATE (rule 9), so saving on every click
  would write an audit row per click. The cost is that a crash loses at most
  thirty seconds of answers.

## Results: the not-exists lie, avoided before it shipped

A subject teacher who is not the class teacher reads **no** enrolments of the
section. `teachers view own section enrolments` belongs to the class teacher.
So an INVOKER results screen would list nobody as *not started*, which is rule
4's *invoker over row-ownership RLS lies quietly* with a roster in it. That is
why `online_test_results` is a definer:

- it filters every table by tenant **by hand**;
- it asks the write policy's question to decide who may read it (the course's
  teacher, the class teacher or an administrator);
- it **refuses** anyone else rather than returning empty.

Probed: the other teacher, the student and another college's administrator are
all refused.

## The second consumer decides the unit

`live_class_courses()` (0272) answered *"which courses may I set work for"*,
and nothing about it was specific to live classes. Tests are its second
consumer, so the definition moved to `teaching_courses()` and the old name now
wraps it. The two screens cannot come to disagree.

## Probed

These ran in rolled-back transactions on the demo college: a course created in
2026-27, two children enrolled, and temporary teacher, student and parent
logins.

| case | result |
|---|---|
| teacher sets a test, 3 questions (a blank option dropped) | ok; `["1/5","5/1","1/2"]` |
| two options differing only in case / key out of range | refused in a sentence each |
| edit after publish / direct key update after publish | refused / **0 rows** |
| student reads `online_test_questions` | **0 rows** |
| student's list | 1 test, question count 0 |
| paper | 3 questions, the word `correct` nowhere in it, due 30.0 min after start |
| save with a foreign id and a choice of 9 | both dropped |
| student writes `score` directly / calls the marker | `permission denied` twice |
| review before close | refused, with the close in the college's time |
| submit, then submit again | 3 of 4, identical second time |
| parent: list / child's mark / questions / start | 1 / 3 of 4 / 0 / refused |
| lapsed sitting on the results | *lapsed*, provisional 2 of 4 |
| unpublish / direct status update / delete | refused / `23514` / refused |
| other teacher, student, another college on results | all refused |
| class teacher: results / write a question | the roster (1 child enrolled in that probe) / refused |
| review after close (window moved back) | the key and the choice, per question |
| review with answers hidden | refused |
| five schema guards | 0 / 0 / 0 / 0 / 0 |

`tests/online-tests/online-tests.test.ts` is the static half, 31 checks. Four
plants proved it can fail:

- a student policy on the questions;
- the key added to the paper;
- a write policy on the sittings;
- a five-minute grace in one function.

Each was caught, and each check went green again on revert.

## Not built, and named

- question banks and shuffling;
- more than one correct option;
- free-text answers (those need a person to mark them, which is homework);
- negative marking;
- retakes;
- a mobile contract block (rule 14 makes that a versioned decision, not a
  quick addition);
- an announcement when a test is published (rule 10's raiser shape, whenever
  it is wanted).
