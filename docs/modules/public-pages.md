# A college's public pages

Migrations `0361`–`0363`. Routes under `/college/[slug]`, public in the
middleware beside `/apply`.

The reference's public site has nine pages. Two are deliberately not built
(fee lookup and invoice by admission number: a balance found that way tells
anybody what a family owes). The admission form is `/apply` (`0268`). These
are the other six:

| Page | Route | Function | What it needs |
|---|---|---|---|
| Index | `/college/[slug]` | `public_college` | nothing; lists only the pages switched on |
| Admission enquiry | `/enquiry` | `public_enquiry` | a name and a phone or email |
| Staff application | `/jobs` | `public_staff_apply` | a name, a post, a phone or email |
| Certificate verification | `/verify` | `public_certificate_check` | serial **and** holder's date of birth |
| Exam timetable | `/exams` | `public_exam_timetable` | nothing; exams marked public |
| Admit card | `/admit-card` | `public_admit_card` | exam, admission number **and** date of birth |
| Results | `/results` | `public_results` | admission number **and** date of birth |

## Shaped by the definer guard

Each function is `SECURITY DEFINER`, granted to `anon`, and named with its
reason in `definer_guard_violations()`. No table policy is opened to `anon`.
Inside a definer no policy runs, so each body is the whole check:

- **Off until switched on.** `public.pages` (Settings → Front office) holds one
  boolean per page, all false by default. The timetable and admit cards also
  need the exam marked public on its own page (`exams.public_timetable`),
  because a draft exam's dates are a draft.
- **One null for every refusal.** An unknown slug, a page switched off, a wrong
  date of birth and a certificate that does not exist look the same, so no page
  is a way to ask which is true (`0209`).
- **Two facts, never one.** Admission numbers and certificate serials are
  sequential. A lookup by one of them alone is a listing anybody can step
  through, so every lookup also needs the date of birth on record.
- **Counted, under a lock.** Every lookup and every application writes a row
  to `public_page_hits` and is refused past the college's hourly limit
  (`lookups_per_hour`, default 120; `applications_per_hour`, default 20). A
  lookup is counted whatever it finds, or the limit would bound only the
  people it is not for. The table is append-only and audit-exempt: the row is
  the record (rule 9).
- **The function decides what is written.** An enquiry gets its number, year,
  source (`website`), status and follow-up date inside `public_enquiry`; a
  staff application gets its status inside `public_staff_apply`. The actions
  send what the person typed and the slug, and
  `tests/public/public-pages.test.ts` checks the keys in both directions.

## Three things the probes found

- **A public visitor has no tenant in a token.** `student_takes_subject` read
  `current_tenant_id()`, so asked by an anonymous admit card it would have
  said every child takes every elective. The body now takes the college as a
  parameter (`student_takes_subject_for`, revoked from every JWT role), and
  the old name is its wrapper: rule 6's `notify_send_for` shape, safe because
  its protection was a tenant check and nothing narrower.
- **Results of the working year only would have hidden every result after a
  promotion.** Probed in the college that had just rolled over, every
  published result was in 2025-2026. `0362` shows the ten most recent
  published results of any year, each with its year: the "data vanished after
  promotion" report (`0355`) arriving on a public page.
- **The admit card had no exams to offer** while the timetable page was off,
  because the only list of public exams was the timetable. `0363` has
  `public_college` name them (id and name only) while admit cards are on.

## The office's half

- Enquiries land on `/front-office` as **Website** enquiries, due for a call
  the day they arrive, beside the ones from `/apply`. The front office shows
  which public pages are open and their address.
- Staff applications are at `/staff/applications` (linked from the staff
  list), read and decided by whoever holds `staff.manage`. A column grant keeps
  what the applicant wrote as written. **Hire** opens `/staff/new` filled in
  from the application; saving the record marks the application hired and
  links it, and a failure to link is a warning beside the success, never a
  failed hire.
- Each exam's page has a *Public timetable and admit cards* switch.
