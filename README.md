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
| [docs/modules/attendance.md](./docs/modules/attendance.md) | Attendance: the keyboard-first register and why it deviates |
| [docs/modules/fees.md](./docs/modules/fees.md) | Fees: the append-only ledger, gapless receipts, and one real bug |
| [docs/design/decisions.md](./docs/design/decisions.md) | Palette, type, spacing — and why |
| `design-system/schoolos/MASTER.md` | Source of truth for all UI values |

## What exists today

- Multi-tenant foundation: tenants, academic sessions, people/students/
  guardians/staff, enrolments, class levels, sections, roles, permission
  matrix, invitations, user profiles, audit log, jobs queue, settings
- RLS on every table, with row-ownership rules for teachers, parents, students
- Library module end-to-end as the reference implementation
- Students register: admission, editing, status changes, guardian links
- Attendance: keyboard-first register, autosave, per-class report
- Fees: append-only ledger, gapless receipt numbers, reversals, collection screen
- Fee counter: keyboard-first data entry (receive, raise dues, discount/fine,
  refund) plus a day book for reconciling the drawer
- Razorpay payment links, settled into the ledger by a signature-verified
  webhook (needs keys on the Edge Functions before it does anything)
- Invoice email queued to a school-configured address — **queue only, no
  sender is connected**
- App shell: role-driven nav, breadcrumbs, ⌘K command palette, theme toggle
- DataTable and form primitives
- Dashboard with KPIs and charts

Everything else in `docs/domain/erd.md` under "Roadmap" is deliberately not
built yet.
