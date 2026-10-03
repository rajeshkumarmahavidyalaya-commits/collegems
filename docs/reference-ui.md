# The reference layout (Weblizar School Management)

The interface now follows the layout of the Weblizar School Management
plugin's super-admin screens. It has a green administration toolbar, a 220px
sidebar of modules (School Management, SM School, SM Academic, …), a
lavender school and session band, green title bars and horizontal metric
cards. It also has a month calendar on the dashboard, a step-by-step setup
wizard and a DataTables-style table toolbar. The data, the permissions and
every write are unchanged: this is a new face on the same backend.

The starting point was a local implementation made elsewhere and supplied as
a ZIP (`collegems-reference-ui.zip`, with `UI-IMPLEMENTATION.md`). Its base was
this branch at `cba525a`, so nothing in it predates newer backend work. It
was ported file by file rather than copied. The corrections are listed below.

## What is verified, and what is not

Walked through on 3 Oct 2026, after the environment was given access to the
Supabase project and to the reference site. The app was a production build
(`next build` + `next start`), signed in as Northgate Academy's test
administrator and test teacher. Northgate is the designated test college,
and nothing was written anywhere else.

| | status |
|---|---|
| **Every signed-in screen loads** | 77 routes opened as the admin and as the teacher. All return 200. The one failure is `/checks` (see below). A role refused a screen gets a sentence or a redirect, never a crash. |
| **Menu per role** | Admin 64 entries, teacher 36. Every entry the teacher is offered opens. |
| **Writes, checked in the database** | Through the UI: a class (`UIT Grade 1`), its section `A`, a student admitted into it (`UIT-0001`, enrolled in the current year, audit row naming the test admin) and two library books. Each row is in Northgate. |
| **Search Students by class** | Returns only that class's student, in the table and in the CSV. |
| **Export** | The CSV holds the filtered set (one row), not the page. |
| **Phone width (375 px)** | 9 screens per role, none scrolls sideways. |
| **School isolation** | Each login sees only Northgate's students (DB probe, both directions). |
| **Layout against the reference** | Compared with the public demo's super admin screens, read-only (below). Not pixel-compared. |
| **Types, lint, unit tests, production build** | Pass. |

### Compared with the reference

The reference was opened through its public "Super Admin Log in" demo button.
The browser could send only GET requests, apart from that one sign-in POST.
Any navigation whose address mentioned delete, remove, reset, trash, logout,
licence or an `action=` was blocked. Its tables load their rows through POST
requests, so they came up empty; no reference record was read or copied.

**Matches:** the green toolbar, the module sidebar and its headings, the
lavender school and session band ("Current Session:" with a pill), the green
"School Dashboard" bar with buttons on the right, horizontal stat cards with
an icon tile, the School Calendar with Today and a coloured legend, the
Search Students panel (keyword or class radio, "Get Students!"), and the table
toolbar (Show N rows, Copy, CSV, Excel, PDF, Print, Column visibility).

**Brought into line on 3 Oct 2026, from `docs/reference-inventory.md`:**

- **Every module page** has the green, centred title bar with an icon and
  its buttons outlined in white. It is one CSS rule over each page's own
  heading block, and the shell lends the heading the active menu entry's
  icon. Measured over 78 routes in light and dark mode: every page has the
  bar, at 4.53:1 and 7.03:1 contrast.
- **Every table** has the green header row, and the table buttons are the
  grey group.
- **Every form section** is a white card with an inset, centred green bar.
- **The dashboard** has the reference's twelve cards in its order and
  colours, its three buttons, and its two lists (last 10 active inquiries,
  last 15 admissions this session). Each figure is gated on the permission of
  whoever acts on it, and a hidden one is named, never shown as zero.
- **Menu names, page titles and button names** are the reference's (Manage
  Classes, Staff List, Fee Types, Books Issued; Student Fee Invoices, Collect
  Payments, Manage Exams; Add New Book, Add Student, Issue Book, and so on),
  with Holidays beside Subjects. Header links where this product has the
  destination: View Books Issued, Payment History, Add New Fee Invoice, Add
  Event, Add Holiday, Bulk Admission, View Students.
- **Students** has the reference's columns and its Search Field (Admission
  Number, Name, Phone, Email, Address). **Invoices** shows Payable, Paid, Due
  and Paid / Partially Paid / Unpaid. **Staff** shows email and joining date.
- **Admission** is titled "New Admission For Session: ...", with sections
  named Personal Detail and Admission Detail.

**Built on 3 Oct 2026 (migration `0321`):**

- **Expenses and Donation**, with their category pages and add forms, in the
  reference's columns and fields: Title, Category, Supplier or Doner Name,
  Amount, Invoice Number, Date, Note, Action; a Start/End Date filter, a
  total and Export. An expense is a posted voucher on an expense account, a
  donation one on an income account, and a category *is* that account, so
  the books, the trial balance and these screens cannot disagree.
  `accounts_record_cash_entry` posts through `accounts_record_cash` (one way
  money reaches the books) and keeps the title, party, invoice number and
  note in `cash_entry_details`. The Action column is **Reverse**, never Edit
  or Delete: a posted voucher is corrected by an opposite one (rule 6), and a
  reversed entry stays listed, struck through, and out of the total. Gated
  on `accounts.view` / `accounts.post` / `accounts.manage`, held by
  accountants and administrators. **Attachment is not offered**: nothing
  stores a file against a voucher yet, and a file field that keeps nothing
  would be a control that lies.
- **Student Birthdays**: `student_birthdays(from, to)`, INVOKER over the
  roll, soonest first, with the age each child turns. A range crossing the
  new year works, 29 February falls on 28 February in a common year, and a
  range of a year or more is refused because a birthday would then appear
  twice. Opens on the next thirty days.

- **Admit Cards** (migration `0322`): `/exams/admit-cards` lists this
  year's exams; each opens its cards a class at a time, printed by the
  browser. `exams_admit_cards(exam, class)` reads every line from a row: the
  class's active children, the papers each sits (through
  `student_takes_subject`, so an elective nobody chose is not on their card),
  each paper's date and exam period, and the room and seat from a
  **published** seat plan only. A paper with no published seat prints a dash,
  and the screen says how many and where to publish. There is no Generate
  step to copy: the reference's Generate is the moment a seat plan is
  published. Gated on `exams.manage` inside the function (a teacher is
  refused in a sentence, never shown an empty class). Not printed: the
  photograph and the exam centre, which this backend does not store per exam.

Verified in the browser on Northgate as the administrator (an expense and a
donation recorded, listed, totalled and reversed; a duplicate category
refused; no horizontal scroll at 375 px) and as a teacher (refused in a
sentence; no Expenses or Donation in the menu; Birthdays reachable). The
walkthrough's vouchers JV-2025-00001 to -00005 in Northgate are those tests,
each reversed. Admit cards were checked on a "Walkthrough Term Exam" kept in
Northgate (two papers, one published seat plan): the seated paper shows Walkthrough
Hall, seat 1; the other a dash and the note; the print view is one clean card;
a teacher is refused; no horizontal scroll at 375 px. Northgate's two students have no date of birth, so the
birthday list was checked with dates set inside a rolled-back transaction
(29 February, a new-year range, a leap year).

**Still differs:**

- **"Unpaid Invoices"** on the dashboard is shown as students with dues.
  This backend keeps balances per child, not per invoice.
- **Fields this backend does not store**: religion, caste, category, mother
  tongue, birth place, previous school, medium, house, student type on the
  admission form; per-student fee structure and login creation inside
  admission (logins are invited from Admins); suspension.
- **Columns not shown**: a staff member's salary, role and login (a
  permission decision, not a layout one); a student's login and enrollment
  number; a book's rack, book number and price, and other module lists not
  reworked yet (books, exams, routes, hostels, items).
- **Placement**: on Hostels and Transport Routes, "Add New ..." sits on each
  section's card rather than in the title bar. Library Cards has no "Issue
  Library Cards" button, because a card is issued from the student's or
  staff member's own record.
- **Our extras stay** under the reference dashboard: the setup checklist,
  the module grid, the two registers and the charts.
- **Modules this backend does not have**: Medium, House, Activities, Lessons
  and Chapters, Tickets, Gate Pass, Chat, Staff Rating, ID card layouts,
  transfer between schools, webcam and QR attendance.
- **No pixel comparison.** Layout and structure were matched against
  screenshots side by side. The reference's own CSS and images were not
  copied.

### Found and fixed during the walkthrough

- **`/checks` timed out.** One critic, `certificate_school_values_problems`,
  built a whole student certificate to compare seven school fields: 1.6-8.9 s
  against the 8 s statement timeout, which takes every other critic down with
  it. Migration 0319 removes the cause: checked on 9 snapshots across both
  colleges (0 different) and applied on 3 Oct 2026.
- **A teacher opening `/staff` saw a table loading for ever**, then "That did
  not load". The roster RPC refuses them, correctly. The page now says "Your
  role does not open the staff roster" instead of mounting the table.
- **"Classes & Sections" opened the Subjects tab** once a class existed. That
  default dates from when one menu entry led there. It now opens Classes,
  and the two "Assign subjects" links name their tab.
- **"Across 1 sections"** on the dashboard.
- **The students list showed any year's class.** Its embedded enrolments
  had no session filter, so whichever enrolment the join returned first was
  shown. It now reads the current session's.

### Measured, not fixed

- **`/online-tests` timed out for an administrator under load.** Fixed in
  migration 0320: `online_tests_list()` now reads each of its two tables
  once, grouped by test, instead of in four correlated subqueries that each
  brought in that table's policies. 68-99 ms against 155-289 ms on a quiet
  database, with the same rows (checked on seeded data, rolled back).
- **`/checks` timed out.** Fixed in migration 0319 (0.4-1.6 s now).
- **Statement timeouts recur under load.** `/library/issues` and `/students`
  each timed out once during the sweeps. The cause is not the cron jobs:
  `jobs_tick` and both schedule ticks stayed under 2.7 s over two hours. The
  same queries run in 12-285 ms on their own. `pg_stat_statements` shows
  spikes (`module_cards` averages 503 ms with a 7.5 s maximum), which points
  at the database instance's capacity when several pages load at once.

- **Pages take 3-9 s here, and a save takes 2-8 s to show.** Each request from
  this container to Supabase costs about 170 ms. The database's own statistics
  show the same reads running in 8-21 ms on average. A page makes 6-18
  requests in 4-6 sequential steps. So the time is the distance between this
  environment and the database, not the pages. A deployment near the database
  should not see it, but that is not measured.
- **Northgate's current year ended on 31 Mar 2026**, so a child admitted today
  counts as 0 "admitted this year". This is rule 2's stale flag, and
  `/academics/sessions` is where a school switches years.
- The first of two "Add book" attempts saved its book and then left the form
  on screen for 60 s. The second went to the book's page in 7.6 s. Not
  reproduced.

## Reference screen → route → backend

| Reference | Route | Components | Backend (unchanged unless noted) | Entities | Gate |
|---|---|---|---|---|---|
| Toolbar, sidebar, school/session band | every signed-in page | `shell.tsx`, `app-sidebar.tsx`, `reference-navigation.ts`, `school-context.tsx` | `navForRole` (role filter), `getUserContext` | `user_profiles`, `roles`, `academic_sessions` | menu: role list; each page checks its own permission |
| School Dashboard | `/` | `PageToolbar`, `StatCard`, `SchoolCalendar` → `MonthCalendar` | `dashboard_summary()`, `school_calendar()` | aggregates of every module | blocks gated inside `dashboard_summary`; buttons on `academics.manage` / `students.manage` |
| Setup Wizard | `/setup` (new) | `SetupWizard` | `setup_progress()` (0284/0310) | settings, sessions, classes, fees, staff, students, logins | steps per permission inside the RPC; menu entry beside `/academics/sessions` |
| Sessions | `/academics/sessions` | existing | existing guarded switch | `academic_sessions` | `academics.manage` |
| Classes & Sections / Subjects | `/academics`, `/academics?tab=subjects` | existing editor | existing actions | `class_levels`, `sections`, `subjects` | `academics.manage` to edit |
| Settings (tabs) | `/settings/school` | `SettingsTabs` | `setting_set`, catalogue | `settings`, `reference.settings_catalog` | per key |
| Students (Search Students) | `/students` | `StudentsTable` search panel | `listStudents` — **class filter fixed** (below) | `students`, `enrolments`, `people`, `guardian_student` | RLS |
| Admission | `/students/new` | existing form, three columns on wide screens | existing `createStudent` | `people`, `students`, `enrolments` | `students.manage` |
| Attendance (Take / View) | `/attendance`, `/attendance/report` | existing | existing | `attendance_records` | `attendance.mark`; View drawn on `attendance.view` |
| Calendar | `/calendar` | `MonthCalendar` + agenda | `school_calendar()` | holidays, exams, instalments, notices | invoker, each source's policies |
| Fee invoices, balances, collect, history | `/fees/*` | existing, new toolbar | existing | `invoices`, `ledger_entries` | existing |
| Library, staff | `/library/*`, `/staff` | existing, new toolbar | existing | as before | existing |
| Expenses, Donation (+ categories, add) | `/accounts/expenses`, `/accounts/donations` (new) | `cash-book-pages.tsx`, `cash-book.tsx` | `accounts_record_cash_entry`, `accounts_cash_entries` (0321), `accounts_reverse_voucher` | `journal_vouchers`, `voucher_lines`, `cash_entry_details`, `accounts` | `accounts.view` / `.post` / `.manage` |
| Admit Cards | `/exams/admit-cards`, `/exams/[examId]/admit-cards` (new) | pages, `SectionPicker`, `PrintButton` | `exams_admit_cards` (0322) | `exam_subjects`, `enrolments`, `exam_seat_allocations` | `exams.manage` inside the RPC |
| Students Birthdays | `/students/birthdays` (new) | page | `student_birthdays` (0321) | `students`, `people`, `enrolments` | `students.view`; RLS decides rows |
| Platform "School Management" | `/platform` | toolbar, platform menu, `PageToolbar` | `platform_colleges()` | metadata only (0209) | operator only |

Not reproduced, because this backend has no such capability: Medium, House,
ticketing, chat, staff ratings, gate pass, and the
plugin's own license, reset and uninstall screens. Nothing in the menu
pretends otherwise.

## Corrections made while porting

- **English-only text.** Every module heading, renamed entry, toolbar label,
  calendar label, wizard step control and table button now has a message key
  in English, Hindi and Urdu (rule 15). The supplied menu replaced the
  existing translations with English.
- **A search field that did nothing.** The supplied "Search Field" dropdown had
  one option and no effect. It is gone. The keyword search covers the
  admission number, which is what `listStudents` searches, and its hint says
  so.
- **The class search did not filter.** `listStudents` filtered on a plain
  embedded `enrolments` resource, which trims the embedded rows and keeps
  every student. Students in other classes came back with no class shown. It
  uses `enrolments!inner` when a class is chosen.
- **Exports covered one page.** Copy, CSV, Excel, PDF and Print now export
  every row that matches the current search and filters, in the visible
  columns. The browser reads it in pages of 500 as the signed-in person, so
  RLS is still the gate. Above 10,000 rows it refuses and gives the number
  instead of truncating (rules 7 and 13). This covers all eight server-paged
  lists. A cell beginning `= + - @` is made inert in CSV, and Excel writes
  every value as text.
- **Controls that would refuse you.** The supplied menu offered the setup
  wizard wherever `/academics` was in the menu. `setup_progress()` gives every
  role but the administrator 0 steps on the default matrix, so a teacher
  would have reached a wizard with nothing in it. It now sits beside the
  sessions screen. The dashboard's buttons and the attendance "View" tab are
  drawn on the permission their screens check.
- **The platform page had two `<h1>`s and a "My School" link.** An operator
  has no school (0209), so that link led nowhere. Both are fixed.
- **Contrast.** The reference's grey `#6c757d` measures 4.36:1 on the lavender
  band, below 4.5:1. The secondary text is one shade darker (`#5c636a`,
  5.66:1). White on the green is 4.53:1. Dark mode keeps a green accent
  (7.03:1).
- **Hardcoded colours.** The supplied stylesheet wrote hex values inside
  component classes. Every colour is now a token on `:root`/`.dark`.
- **Not taken:** the `/ui-preview` fixture route (no fixture data sits beside
  production routes), and the Windows-specific `next.config`, `eslint` and
  `package.json` changes.

## Found while trying to run it

**A sign-in that could not reach the server said the password was wrong.**
`login/actions.ts` turned every error into *"That email address and password
do not match"*. That sends somebody round the password-reset loop during an
outage. Only a refusal of the credentials says that now; anything else says
the server could not be reached.

## Running it

```bash
cp .env.production .env.local   # public URL and publishable key only
npm ci && npm run dev           # http://localhost:3000
```

The browser walkthrough needs `bbwdkglcndaoiqmzdliq.supabase.co` reachable
from wherever the app runs.
Test logins for **Northgate Academy** (the designated test college) are
`ui-test.admin@northgate.test` and `ui-test.teacher@northgate.test`. Their
passwords are not in the repository; reset them from the Supabase dashboard
if needed.
