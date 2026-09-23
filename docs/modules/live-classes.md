# Live classes

Migrations `0270`-`0272`. `/live-classes`, for the administrator, teachers,
students and parents.

Before this there were zero meeting links anywhere in the schema or `src/`. A
college teaching online sent links over WhatsApp, where they were forwarded to
people who were not in the class and lost by the people who were.

What this builds is deliberately small: **a lesson, on a date, for one class,
with an address to join it at.** The meeting happens on a provider's servers.

## The shape

| | |
|---|---|
| `live_classes` | one lesson, keyed onto `section_subjects` (this class studies this subject this year) |
| `live_class_schedule(jsonb)` | INVOKER; the college's wall clock in, an instant out; generates Jitsi rooms |
| `live_class_cancel(id, reason)` | INVOKER; a reason is required because families read it |
| `live_classes_between(from, to)` | INVOKER read over row-ownership RLS, with the college's timezone per row |
| `live_class_courses()` | what the caller may schedule for, in every year that has not ended |
| `liveclasses.view` / `liveclasses.manage` | granted like `homework.view` / `homework.manage`, in existing colleges and in new ones (`0269`) |

The policies are homework's, row for row. The subject teacher writes. The class
teacher, the student and the guardian read. The administrator does either.

## Four decisions

**The address is an allowlist, not a text box.** A link the college's own
product shows to 300 families is a link the college vouches for, and a free-text
field would be a phishing vector with the college's name on it. `join_url` must
match its provider's shape in a CHECK: Google Meet `abc-defg-hij`, a Zoom meeting
number, a Teams join link, or a Jitsi room **the database generates** from 12
random bytes, so a room nobody was sent is a room nobody can guess. The browser
carries the same patterns for the message; `tests/live-classes` fails when they
drift.

**Two lessons for one class cannot overlap.** This is enforced by an exclusion
constraint over `tstzrange(starts_at, ends_at)`, partial on `scheduled`, so a
cancelled lesson gives its slot back. `ends_at` is stored rather than generated
from a duration, because `timestamptz + interval` is only STABLE.

**Times are instants, entered and shown as the college's wall clock.** The write
resolves a date and a time with `tenants.timezone`. The page formats every time
with that timezone, because a Server Component on Vercel runs in UTC: a 10:00
lesson in Kolkata is 04:30 UTC.

**The year is the section's.** A date outside it is refused in a sentence
(`0198`'s refusal, for a lesson). The Join button opens 15 minutes before the
lesson and closes when it ends; that check compares instants, so the reader's
device clock setting cannot move it.

## Probed as every seat, in a rolled-back transaction

| seat | result |
|---|---|
| admin, this year's section | *That lesson would already be over* / *1 Oct 2026 falls outside 2025-2026* |
| teacher T, next year's course | Jitsi lesson at 10:00 Kolkata stored as 04:30 UTC, filed under 2026-2027 |
| T, overlapping lesson | `23P01`, translated at the action |
| T, `https://zoom.us.evil.example/j/...` | `23514` on the URL CHECK |
| T2, not this subject's teacher | refused in a sentence; cannot cancel T's lesson; sees 0 lessons |
| parent | their child's lesson only, with the teacher's name through `staff_directory` |
| parent, schedule | refused: needs `liveclasses.manage` |
| accountant | 0 lessons |

The five schema guards read 0 after each migration.

## What the probe found (0271, 0272)

- **The Cancel button asked a different question from the policy.** `0270`
  compared the teacher frozen onto the lesson; the policy asks the course's
  teacher today. A teacher who could cancel was drawn no button, and after a
  mid-year handover the old teacher would have been drawn one the policy
  refuses. `0271` makes the flag the policy's predicate, word for word.
- **The course list could not come from the class picker.** The demo college's
  current-session flag still points at 2025-2026, which ended in March, so all
  96 of its courses could only take a lesson in the past. `live_class_courses()`
  asks which years have not **ended**, which is a date question, not the flag.
  On the demo college it returns **0** today, because 2026-2027 has twelve
  sections and no subjects assigned. The screen says so and links to Academics
  rather than showing an empty dropdown.

## Checked in a browser

This used a throwaway preview route with fixed data. The live page needs the
database, which the sandbox cannot reach. Three lessons were rendered in each
of the three states (joinable, *Opens at 17:15*, cancelled with its reason),
in Urdu at 375px and English at 1024px, with no horizontal scroll. The Join
link opens in a new tab so the list is still there when the lesson ends.

## Not built

- **Attendance at a live lesson.** The provider knows who joined; this product
  does not, and a register nobody took is not a register.
- **Recordings.**
- **A notification per lesson.** The list is where a family looks; an
  announcement is the notice board's job if a college wants it.
- **Provider API integration** (creating the Zoom or Meet meeting from here).
  It would need per-college OAuth credentials, which rule 6 says live only on
  Edge Functions, and it gains nothing a pasted link does not already give.
