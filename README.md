# SchoolOS

Multi-tenant school ERP. Next.js 15 (App Router) + Supabase (Postgres, Auth,
Storage, Edge Functions) + Tailwind v4 + shadcn/ui.

Tenant isolation is enforced by Postgres Row Level Security reading the JWT —
not by application code. Read [CLAUDE.md](./CLAUDE.md) before changing
anything; it is the working agreement, not a summary.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL + publishable key
npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest integration suite (needs `.env.test.local`) |

The tests hit a real Supabase project through real RLS policies, and need two
admin logins in two *different* tenants — that is what the cross-tenant
leakage suite proves.

## Database

Migrations in `supabase/migrations/`, applied in numeric order. They are
immutable once applied: add a new one, never edit an applied file.

After any migration, regenerate types into
`src/lib/supabase/database.types.ts`.

## Docs

| Document | What's in it |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Architecture rules, conventions, UI workflow |
| [docs/domain/erd.md](./docs/domain/erd.md) | Full schema + the roadmap it's shaped for |
| [docs/modules/library.md](./docs/modules/library.md) | The pattern every module copies |
| [docs/modules/academics.md](./docs/modules/academics.md) | Academic structure: classes, sections, subjects and the teaching calendar |
| [docs/modules/attendance.md](./docs/modules/attendance.md) | Attendance: the keyboard-first register and why it deviates |
| [docs/modules/fees.md](./docs/modules/fees.md) | Fees: the append-only ledger, gapless receipts, and one real bug |
| [docs/modules/promotion.md](./docs/modules/promotion.md) | Promotion: a dry run you can argue with before it writes anything |
| [docs/modules/exams.md](./docs/modules/exams.md) | Exams: grading rules as data, split papers, and two bugs the demo cohort surfaced |
| [docs/modules/reports.md](./docs/modules/reports.md) | The reporting kernel: reports as data, not as forty pages |
| [docs/modules/timetable.md](./docs/modules/timetable.md) | The class routine: three unique indexes doing all the work |
| [docs/modules/i18n.md](./docs/modules/i18n.md) | Languages and right-to-left: why the locale is not in the URL, and why a translation may be incomplete |
| [docs/modules/mobile-api.md](./docs/modules/mobile-api.md) | The mobile API: three calls, a versioned contract, and why a push token is not an address |
| [docs/modules/notifications.md](./docs/modules/notifications.md) | Notifications: one send path, a dispatcher with real drivers, and the RLS hole that column grants close |
| [docs/modules/homework.md](./docs/modules/homework.md) | Homework: files, signed URLs, and where a column grant stops working |
| [docs/modules/payroll.md](./docs/modules/payroll.md) | HR and payroll: salary as data, and a payslip made immutable by a foreign key |
| [docs/modules/accounts.md](./docs/modules/accounts.md) | The general ledger: three rules, three different devices, and books that tie |
| [docs/modules/report-cards.md](./docs/modules/report-cards.md) | Report cards: a rank is a fact about the cohort, and the attendance line that moved |
| [docs/modules/transport.md](./docs/modules/transport.md) | Transport: a fare keyed on a stop, and why that changed how invoices are built |
| [docs/modules/hostel.md](./docs/modules/hostel.md) | Dormitory: the third billing source, and where the composite-key device stops |
| [docs/modules/front-office.md](./docs/modules/front-office.md) | Front office: the funnel before a student exists, and how it is kept honest |
| [docs/modules/inventory.md](./docs/modules/inventory.md) | Store: the ledger pattern applied to goods, and a message that was a bug |
| [docs/modules/import.md](./docs/modules/import.md) | Bulk import: an editable preview, and why it refuses rather than truncates |
| [docs/modules/dashboard.md](./docs/modules/dashboard.md) | The home page: one round trip, and naming what a role may not see |
| [docs/modules/certificates.md](./docs/modules/certificates.md) | Certificates: preview computes, issue freezes, and the wording is data |
| [docs/modules/schedules.md](./docs/modules/schedules.md) | Work on a timer: a wall clock per tenant, and a run that is not a send |
| [docs/modules/notices.md](./docs/modules/notices.md) | The notice board: a notice is a document, a notification is an event |
| [docs/modules/student-leave.md](./docs/modules/student-leave.md) | Student leave: why approving it must not write the register |
| [docs/modules/substitutions.md](./docs/modules/substitutions.md) | Cover: the roster a teacher sees, and the invoker function that lied quietly |
| [docs/modules/privileges.md](./docs/modules/privileges.md) | The four privileges RLS cannot see, and the guard that keeps them revoked |
| [docs/modules/audit.md](./docs/modules/audit.md) | Reading the audit log: a diff, two kinds of missing actor, and the strictest policy in the schema |
| [docs/modules/settings.md](./docs/modules/settings.md) | Configuration as a catalogue, and why there is no secret value type |
| [docs/modules/concessions.md](./docs/modules/concessions.md) | Concessions: an award, not an inferred rule, and where the cap falls |
| [docs/modules/student-exit.md](./docs/modules/student-exit.md) | Leaving: one act that ends six relationships, not one flag |
| [docs/modules/session-boundary.md](./docs/modules/session-boundary.md) | The session boundary: why a null end date is the end of the year, not for ever |
| [docs/modules/renewals.md](./docs/modules/renewals.md) | Carrying a bus seat and a bed into the new year, through the modules' own doors |
| [docs/modules/checks.md](./docs/modules/checks.md) | Needs attention: every critic on one screen, and what probing as a teacher found |
| [docs/modules/staff-directory.md](./docs/modules/staff-directory.md) | The staff directory: why a row policy could not express "name and designation only" |
| [docs/modules/staff.md](./docs/modules/staff.md) | Staff: the roster, and the gate that is in the function rather than on the page |
| [docs/modules/academic-years.md](./docs/modules/academic-years.md) | Academic years: the flag nobody could move, and six thousand rows filed in the wrong one |
| [docs/modules/family.md](./docs/modules/family.md) | The family's side: the menu offered a parent Payroll and withheld their own fee account |
| [docs/ui-review.md](./docs/ui-review.md) | A UI pass with the app actually running, and the three translated strings nothing rendered |
| [docs/performance.md](./docs/performance.md) | What was actually slow, measured before and after |
| [docs/design/decisions.md](./docs/design/decisions.md) | Palette, type, spacing — and why |
| `design-system/schoolos/MASTER.md` | Source of truth for all UI values |

## What exists today

- Multi-tenant foundation: tenants, academic sessions, people/students/
  guardians/staff, enrolments, class levels, sections, roles, permission
  matrix, invitations, user profiles, audit log, jobs queue, settings
- Academic structure: subjects, rooms, period schedules, teaching-week and
  holiday config, subject-teacher assignment
- RLS on every table, with row-ownership rules for teachers, parents, students
- Promotion: a dry-run preview whose rows an administrator can override, then
  applied — with unpaid balances carried forward as opening invoices
- Exams and grading: papers (split into theory/practical parts where a school
  needs it), keyboard-first marks entry, and a rules engine
  (grade bands, grace, best-of-N, optional subjects) stored as data per school
- Reporting kernel: eight reports across five modules, run through one
  permission-checked dispatcher, with CSV export and print
- Class routine: weekly grid per class, clash-proof by construction, teaching
  load view, and a teacher's own week
- Accounts: a chart of accounts, double-entry vouchers that are immutable once
  posted and reversed rather than edited, and a rules-as-data map that posts the
  fee ledger and payroll into the general ledger — with a trial balance that ties
- HR and payroll: staff attendance and leave, salary structures stored as data
  per school, and a payroll run whose preview is editable rows — finalised by
  one update that makes every payslip immutable through a composite key
- Homework and study material: set, hand in, mark and return, with private
  file attachments served through signed URLs issued after a permission check
- English, Hindi and Urdu, with the locale resolved server-side from the
  person's profile; right-to-left throughout, on logical properties, with a
  coverage report and a per-locale floor a test holds
- Mobile API: three `jsonb` read models (`mobile_bootstrap`, `mobile_home`,
  `mobile_student`) so a phone renders a screen in one round trip, a versioned
  additive-only contract, and device registration for push
- Notification service: one send path, in-app delivery, per-user opt-outs,
  templates, a delivery log, and a dispatcher Edge Function with email (Resend),
  SMS (Twilio), push (FCM) and WhatsApp
  (Meta, template-only) drivers. Whether a channel actually sends depends on the
  build, the school's settings and the deployment's secrets — the Channels
  screen says which of the three is missing
- Library module end-to-end as the reference implementation
- Students register: admission, editing, status changes, guardian links
- Attendance: keyboard-first register, autosave, per-class report
- Fees: append-only ledger, gapless receipt numbers, reversals, collection screen
- Fee counter: keyboard-first data entry (receive, raise dues, discount/fine,
  refund) plus a day book for reconciling the drawer
- Printable per-student invoices, itemised, on a configurable school letterhead
- Razorpay payment links, settled into the ledger by a signature-verified
  webhook (needs keys on the Edge Functions before it does anything)
- Invoice email queued to a school-configured address, sent by the dispatcher
  once `RESEND_API_KEY` is set on the Edge Function
- App shell: role-driven nav, breadcrumbs, ⌘K command palette, theme toggle
- DataTable and form primitives
- Dashboard with KPIs and charts

Everything else in `docs/domain/erd.md` under "Roadmap" is deliberately not
built yet.
