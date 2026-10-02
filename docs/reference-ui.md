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

| | status |
|---|---|
| **Visual parity with the reference** | **Not verified.** `wpschool.weblizar.com` is refused by this environment's network policy, so no screen was compared. The layout comes from the supplied implementation, whose own notes say it is "not a verified pixel-perfect clone". |
| **Browser walkthrough of signed-in screens** | **Blocked.** The Supabase project host is refused by the same policy (`403` at the egress proxy), so the app runs here but cannot sign anybody in. The login page renders and, after the fix below, says so. |
| **The backend calls the new screens make** | **Probed in the database** as Northgate Academy's test administrator and test teacher: `setup_progress()` 11 steps for the admin (2 done), 0 for the teacher; `school_calendar()` reads; each login sees 1 student, its own college's, and 0 of the other college's; `dashboard_summary()` withholds `staff_attendance` and `fees` from the teacher. |
| **Types, lint, unit tests, production build** | Pass. |

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
| Platform "School Management" | `/platform` | toolbar, platform menu, `PageToolbar` | `platform_colleges()` | metadata only (0209) | operator only |

Not reproduced, because this backend has no such capability: Medium, House,
ticketing, chat, staff ratings, donation-specific screens, gate pass, and the
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

The browser walkthrough needs `bbwdkglcndaoiqmzdliq.supabase.co` reachable.
Test logins for **Northgate Academy** (the designated test college) are
`ui-test.admin@northgate.test` and `ui-test.teacher@northgate.test`. Their
passwords are not in the repository; reset them from the Supabase dashboard
if needed.
