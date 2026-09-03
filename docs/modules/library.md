# The library module — the pattern every module copies

The library is small enough to read in one sitting and complete enough to
exercise every layer: migration + RLS, Zod schemas, server actions, a
DataTable list, a detail page, create/edit forms, an atomic multi-row
operation, and integration tests including cross-tenant leakage.

Copy this shape. Where you deviate, have a reason.

## File map

```
supabase/migrations/0015_library_module.sql   tables, RLS, audit triggers, RPCs
supabase/migrations/0016_seed_library_demo.sql  demo data
src/lib/validations/library.ts                Zod schemas (the contract)
src/app/(app)/library/actions.ts              server actions (the data layer)
src/app/(app)/library/issue-book-dialog.tsx   a shared action component
src/app/(app)/library/books/
  page.tsx            server page: header + permission gate + table
  books-table.tsx     client: DataTable + TanStack Query
  book-form.tsx       client: shared create/edit form
  new/page.tsx        create route
  [id]/page.tsx       detail: facts, availability, issue history
  [id]/edit/page.tsx  edit route
src/app/(app)/library/members/                list + table
src/app/(app)/library/issues/                 list + table + return action
tests/library/library-flow.test.ts            business-rule integration tests
```

## 1. Migration first

Every table gets `tenant_id`, RLS enabled, and policies in the same migration
that creates it — never "add RLS later". Three policy shapes recur:

```sql
-- Everyone in the tenant can read the catalog.
create policy "tenant members view books" on public.books
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

-- Only the roles that own the module can write.
create policy "librarians manage books" on public.books
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  )
  with check ( /* same predicate */ );

-- Row ownership: a member sees their own records.
create policy "members view own book_issues" on public.book_issues
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and member_id in (
      select m.id from public.members m
      where m.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
         or m.staff_id   = ( select up.staff_id   from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  );
```

**Always wrap `auth.uid()` and the helper functions in `( select … )`.**
Postgres then evaluates them once per query instead of once per row. On a
300-row table it does not matter; on attendance it will.

Then attach the audit trigger:

```sql
create trigger audit_books after insert or update or delete on public.books
  for each row execute function public.audit_row_change();
```

## 2. Atomic operations belong in Postgres

`supabase-js` cannot open a transaction, so "check availability, decrement it,
insert the issue" as three client calls can interleave and oversubscribe a
book. It is one function instead:

```sql
create or replace function public.library_issue_book(
  p_book_id uuid, p_member_id uuid, p_due_at date default (current_date + interval '14 days')
) returns public.book_issues
language plpgsql
set search_path = public
as $$ … select … for update; … $$;
```

Notes that generalise:

- **`SECURITY INVOKER`** (the default — don't write `SECURITY DEFINER` here).
  The function runs as the calling librarian, so their RLS policies still
  decide whether the write is allowed. The function only adds atomicity.
- `select … for update` takes the row lock before the availability check.
- It resolves the session itself via `current_session_id()` — the client never
  supplies it.
- Business rules that must always hold (borrowing cap, "no copies available")
  live here, not only in the UI.
- `revoke all … from public, anon; grant execute … to authenticated;`

## 3. Zod schema is the contract

`src/lib/validations/library.ts` is imported by both the form and the server
action, so they cannot drift.

Avoid `z.coerce.number()` in form schemas — it makes the schema's input type
`unknown`, which breaks the react-hook-form resolver's generics. Keep the
schema `z.number()` and convert in the field (`TextField type="number"`
already does).

## 4. Server actions return a result, not an exception

```ts
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
```

Every mutation: parse with Zod → act → `revalidatePath` → return. Expected
failures (validation, a unique violation, a business rule) are **values**, so
the form can map `fieldErrors` back onto fields. Only genuine bugs throw.

List actions take a `ListParams` (`pageIndex`, `pageSize`, `sortBy`,
`sortDesc`, `search`, filters) and return `{ rows, total }`. Sortable columns
are whitelisted server-side:

```ts
const BOOK_SORT_COLUMNS = new Set(["title", "author", "total_copies", …]);
const orderColumn = sortBy && BOOK_SORT_COLUMNS.has(sortBy) ? sortBy : "title";
```

Never interpolate a client-supplied column name into `.order()`.

## 5. Pages: server shell, client table

The `page.tsx` is a Server Component that fetches what it needs for the header
and the permission gate, then renders a client table component:

```tsx
const [ctx, categories, canManage] = await Promise.all([
  getUserContext(), listCategories(), hasPermission("library.manage"),
]);
```

`canManage` decides whether the "Add book" button renders. It is **not** the
security boundary — the RLS policy is. Both exist on purpose.

The client component owns pagination/sort/filter state and feeds it to
TanStack Query with `placeholderData: keepPreviousData`, so paging doesn't
flash empty. The DataTable handles skeleton / empty / error states; you supply
the copy:

```tsx
emptyTitle={search ? "No books match those filters" : "No books in the catalog yet"}
emptyDescription={search ? "Try a different search term." : "Add the first book to start lending."}
emptyAction={canManage ? <Button asChild><Link href="/library/books/new">Add a book</Link></Button> : undefined}
```

An empty state that only says "No data" is a bug. Say why it's empty and what
to do about it — and only offer the action to someone allowed to take it.

## 6. Forms

One component serves create and edit (`book-form.tsx`), switching on whether a
record was passed. It wires:

- `useForm` + `zodResolver` with the shared schema
- `<ErrorSummary>` — focusable, links each message to its field by `name`
- `useUnsavedChangesGuard(isDirty)` — warns on tab close; Cancel confirms
- server `fieldErrors` mapped back with `form.setError`
- a toast for the outcome, then `router.push` to the detail page

## 7. Tests

`tests/library/library-flow.test.ts` covers the rules that live in the
database, against the real database:

- issuing decrements `available_copies` and stamps `session_id`
- returning restores the copy and closes the issue
- a book cannot be returned twice
- the borrowing cap is enforced
- **a librarian in tenant B cannot issue a tenant A book**

That last one is the pattern to copy for every module: prove the boundary from
the outside, with a real signed-in client, not by reading the policy and
believing it.

---

## Fines live in the fees ledger, not here

Since migration `0026`, returning a book late does not just stamp a number on
the issue row — it books an immutable `fine` entry against the student's fee
account, so an overdue book is collected on the same screen, with the same
receipt, as tuition.

Four decisions worth knowing before changing any of this.

### The fine is booked at return, not as it accrues

An overdue book's fine grows every day. A ledger entry is a fixed amount, and
rewriting it daily is exactly what an append-only ledger forbids. So the ledger
records the fine when it is **final** — at return — and the issues list shows
the running amount before then as an estimate, labelled *Accruing*, computed on
the fly and stored nowhere.

That also matches how a library works: you settle when you hand the book back.

### Staff fines go to payroll, not fees

`members` is a student **or** a staff member, and `ledger_entries.student_id`
is `not null` because that module is student fees. A staff member's overdue
book is a payroll matter, not a fee receivable.

Their fine stays on `book_issues.fine_amount` and is **not collectable through
the fees module**. It is instead collected as a deduction line on the next
payroll run and settled by stamping `book_issues.staff_fine_payslip_id`
(migration `0065`), or written off with `library_waive_staff_fine` — the
*Waive* action on the issues list. The list shows *Owed — collected via
payroll*, *Collected on payslip*, or *Waived* accordingly. This was an open gap
until payroll existed to receive it; see `docs/modules/payroll.md`.

### `fine_paid` is gone

Nothing read or wrote it and no row ever set it. For a student the fee balance
now answers it, and a boolean that can silently disagree with the ledger is
precisely the drift the ledger exists to prevent.

### The rate lives in `settings`

`library.fine_per_day`, read by both `library_return_book()` and the accrual
estimate in the UI. It used to be a function default (`2.00`) the app could not
see, so any estimate shown would have been a second hardcoded copy free to
drift from what was actually charged.

### How a librarian is allowed to write to the ledger

`library_return_book` is `SECURITY INVOKER`, so it writes as the librarian who
called it — and the finance-roles policy would reject them. Rather than making
the function `SECURITY DEFINER` (which would hand librarians the entire
ledger), there is a policy granting exactly one shape of row:

```sql
entry_type = 'fine' and book_issue_id is not null
```

A librarian still cannot record a payment, a discount, or a fine unattached to
a book. Both are proven from a real session in
`tests/library/library-fines.test.ts`.

### One fine per issue, forever

`ledger_entries_book_issue_unique` — partial, excluding reversals — is what
makes booking idempotent. A double-submitted return, or a re-run of the
backfill, cannot fine a family twice.

Because reversals are excluded, a wrongly-assessed fine can still be cancelled,
and the reversal carries the same `book_issue_id` so it stays explainable on
the ledger. The consequence: once a fine is reversed, a *corrected* amount
cannot be re-booked against that issue — record it as a manual fine on the fee
account instead.

### Where the amount lives now

`book_issues.fine_amount` remains, as the record of what was assessed on that
issue. The **collectable debt** is the ledger entry. They are written in the
same transaction and the ledger row is immutable, so they cannot drift — but if
a fine is reversed, the issue still shows the original assessment while the
ledger nets to zero. The ledger is the authority.

---

## Checklist for the next module

- [ ] Migration creates tables **with** `tenant_id`, RLS, and policies
- [ ] `( select … )` wrapping on every `auth.uid()` / helper call in a policy
- [ ] Audit trigger attached to each new table
- [ ] Covering index on every foreign key
- [ ] Session-scoped (`session_id`) if the table is transactional
- [ ] Multi-row writes wrapped in a `SECURITY INVOKER` Postgres function
- [ ] Zod schema shared by form and action
- [ ] Actions return `ActionResult`; sortable columns whitelisted
- [ ] Permission codes added to `reference.permissions` + granted to roles
- [ ] List uses DataTable with designed empty/loading/error states
- [ ] Cross-tenant test extended to the new tables
- [ ] `design-system/schoolos/MASTER.md` + page override read before UI work
- [ ] ui-ux-pro-max pre-delivery checklist run against every new screen
