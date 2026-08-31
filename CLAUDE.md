# SchoolOS — working agreement

Multi-tenant school ERP. Next.js 15 (App Router, RSC by default, Server
Actions) + Supabase (Postgres, Auth, Storage, Edge Functions) + Tailwind v4 +
shadcn/ui + TanStack Query/Table + Zod + react-hook-form.

This file is the contract. If a change would break one of these rules, change
the rule here first — deliberately — rather than working around it in code.

---

## 1. Multi-tenancy is the core, not an add-on

- **Every table in `public` carries `tenant_id uuid not null` and has RLS
  enabled.** No exceptions except `tenants` itself, which *is* the tenant (its
  policy compares `id` instead).
- **Isolation is enforced by Postgres, never by application code.** Policies
  read the tenant from the JWT: `public.current_tenant_id()` returns
  `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`. A missing `where tenant_id =`
  in a query is a performance bug, not a security hole — RLS still holds.
- `tests/rls/schema-invariants.test.ts` fails if anyone adds a table to
  `public` without `tenant_id` or with RLS off. It calls the
  `schema_guard_violations()` RPC; an empty result is the passing state.
- `tests/rls/tenant-isolation.test.ts` proves, in both directions, that one
  tenant's signed-in client cannot read, update, delete, or insert into
  another's rows. Extend it whenever you add a tenant-scoped table.
- Truly global, static reference data (the permission catalog) lives in the
  `reference` schema, **outside** `public`, so the invariant test stays
  meaningful. `reference.permissions` deliberately has RLS off: it holds no
  tenant data, and writes are revoked from `anon`/`authenticated` via GRANTs.
  Do not "fix" this by enabling RLS without policies — that would break reads.

## 2. Sessions (academic years) scope every transactional table

- Fees, marks, attendance, enrolments, payroll, timetable and library issues
  all carry `session_id uuid` **directly**, even when it is reachable via a
  join — so every query can filter on it without one.
- **The current session resolves server-side.** Use
  `public.current_session_id(tenant_id)` in SQL or `getUserContext()` in the
  app. Never accept `session_id` from client input.

## 3. Auth

- Supabase Auth. A trigger on `auth.users` (`handle_new_auth_user`) resolves a
  pending row in `invitations` by email, stamps `tenant_id` + `role` into
  `raw_app_meta_data`, and creates the `user_profiles` row. A signup with no
  matching invitation gets no tenant — RLS then denies everything, which is the
  correct failure mode.
- Roles: `admin`, `teacher`, `student`, `parent`, `accountant`, `librarian`.
  They are per-tenant rows in `roles` (so a tenant can add custom roles later),
  and the role *code* is what RLS policies compare against.
- `user_profiles` links a login to the person/student/staff/guardian record it
  acts as. A young student may have no login at all — that is expected.

## 4. Authorization is two layers

1. **RLS** — tenant isolation *and* row ownership. Teachers see only students
   in sections they teach; parents only their linked children; students only
   themselves. This is the real boundary.
2. **Permission matrix** (`role_permissions` × `reference.permissions`,
   role × module × ability) — gates menus and buttons. Read it with
   `hasPermission('library.manage')`.

**The UI layer is never the gate.** Hiding a button does not protect data; the
policy does. Every new module needs both.

## 5. Identity model — do not collapse these

```
people          biographical facts about a human
  ├── students   a person in the student role (admission number, status)
  ├── guardians  a person in the guardian role
  └── staff      a person employed by the tenant
enrolments      student + section + session, one row per year
guardian_student many-to-many, with relationship type
auth.users      login accounts (optional — many students never get one)
```

This is what keeps alumni, re-admission, sibling linking, and
staff-who-are-also-parents representable. Flattening "student" into "person"
looks simpler for a week and then blocks all four.

## 6. Money is append-only

Payments, discounts, fines and refunds are **immutable ledger entries**.
Corrections are reversing entries, never updates. Receipt numbers are gapless
per-tenant-per-session sequences generated in Postgres. Payment webhooks are
idempotent on the provider's event id.

The library module's `fine_amount` is a simple mutable field — the fees ledger
does not exist yet, so there is nothing to be append-only *into*. When the fees
module lands, library fines should move into that ledger.

## 7. Heavy work goes through the jobs table

Report generation, bulk SMS/email, imports, and promotion runs are queued in
`jobs` and consumed by Supabase Edge Functions. **Never inside a Next.js
request handler.** Edge Functions use the service role (bypassing RLS), so they
must filter by `tenant_id` explicitly.

## 8. Storage

Supabase Storage, private buckets only, access via signed URLs issued after a
server-side permission check. Buckets: `avatars`, `documents`,
`study-material`, `homework-submissions`. Store the object *path* in the
database (e.g. `people.photo_path`), never a public URL.

## 9. Audit everything

`audit_row_change()` writes old/new row JSON, the actor (`auth.uid()`) and a
timestamp to `audit_log` on every insert/update/delete of a core table. When
you add a table, add its trigger — see migration `0008` and the four triggers
at the end of `0015`.

---

## UI work — read this before writing any interface code

1. **Read `design-system/schoolos/MASTER.md` first.** It is the source of
   truth for colour, type, spacing, radius, shadow, and motion.
2. **Then check `design-system/schoolos/pages/<page>.md`.** If it exists, its
   rules override MASTER.md. If not, use MASTER.md exclusively. Pages with
   overrides today: `dashboard`, `student-list`, `fee-collection`,
   `marks-entry`, `attendance`, `login`.
3. Regenerate or add page overrides with the ui-ux-pro-max skill:
   ```bash
   python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" \
     --design-system --persist -p "SchoolOS" --output-dir . --page "<page>"
   ```
4. **Never hardcode a hex value or font name in a component.** Everything goes
   through the CSS variables in `src/app/globals.css` and the Tailwind tokens
   mapped from them (`bg-primary`, `text-muted-foreground`, `border-border`,
   `font-mono`, …).
5. **Run the skill's pre-delivery checklist against every screen** before
   calling it done. The non-negotiable subset:
   - Real SVG icons only (lucide-react). **Zero emoji as UI.**
   - Light **and** dark mode, both at 4.5:1 text contrast.
   - `prefers-reduced-motion` respected (handled globally in `globals.css`).
   - Visible focus rings; semantic landmarks; labelled controls; error
     summaries linked to their fields; `aria-live` for async results.
   - Every list has a designed empty state, loading skeleton, and error state.
     Never a spinner on a blank page.
   - Tested at 375 / 768 / 1024 / 1440. No horizontal scroll on mobile; wide
     tables scroll inside their own container.
   - Badge/status meaning never relies on colour alone — pair it with text.
   - Long names, URLs and chip groups reflow without clipping at 200% zoom.
   - Destructive actions are confirmed and, where data permits, undoable.

### Amber is not a hover colour

The generated palette's amber (`--brand-accent`) is for **sparing emphasis** —
an overdue badge, a highlighted stat. shadcn's `--accent` token is a subtle
neutral hover tint and must stay that way. Making every hover amber would wreck
the calm, institutional feel this product is aiming for.

---

## Conventions

- **Server Components by default.** Reach for `"use client"` only when you need
  state, effects, or event handlers.
- **Mutations are Server Actions** returning a discriminated
  `ActionResult<T>` (`{ ok: true, data }` | `{ ok: false, error, fieldErrors }`)
  — see `src/app/(app)/library/actions.ts`. Never throw across the boundary for
  expected validation failures.
- **Validate with Zod at the server boundary**, even when the client already
  validated. The client is a convenience; the server action is the gate.
  Avoid `z.coerce` in form schemas — it splits the input/output types and
  breaks the react-hook-form resolver. Convert in the field instead.
- **Multi-step writes that must be atomic go in a Postgres function**
  (`library_issue_book`, `library_return_book`). supabase-js cannot open a
  transaction, so a sequence of client calls can interleave. Keep these
  `SECURITY INVOKER` so RLS still applies to the caller.
- **Lists use the DataTable primitive** (`src/components/data-table/`) with
  server-side pagination/sort/filter. Whitelist sortable columns server-side —
  never interpolate a client-supplied column name into `.order()`.
- **Forms use the form primitives** (`src/components/forms/`): `TextField` /
  `SelectField` / `TextareaField`, `ErrorSummary`, `useUnsavedChangesGuard`.
- Generated DB types live in `src/lib/supabase/database.types.ts`. Regenerate
  after every migration.
- Migrations are numbered and immutable once applied. Add a new one; never edit
  an applied file.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (needs .env.test.local — see .env.example)
```

The integration tests hit a real Supabase project through real RLS policies.
They need two admin logins **in two different tenants**; that is the whole
point of the cross-tenant suite.
