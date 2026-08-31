-- Library module: the reference implementation every future module copies
-- (see docs/modules/library.md). books/book_categories/members/book_issues,
-- full RLS, and two SECURITY INVOKER RPCs (issue/return) that make the
-- "decrement/increment available_copies" step atomic with the ledger row --
-- something a sequence of separate supabase-js calls from a server action
-- cannot guarantee.

create table public.book_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index book_categories_tenant_idx on public.book_categories (tenant_id);

alter table public.book_categories enable row level security;

create policy "tenant members view book_categories" on public.book_categories
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "librarians manage book_categories" on public.book_categories
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  );

create table public.books (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.book_categories(id) on delete set null,
  title text not null,
  author text not null,
  isbn text,
  publisher text,
  edition text,
  shelf_location text,
  cover_path text,
  total_copies integer not null default 1 check (total_copies >= 0),
  available_copies integer not null default 1 check (available_copies >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint books_available_le_total_chk check (available_copies <= total_copies)
);

create index books_tenant_idx on public.books (tenant_id);
create index books_tenant_category_idx on public.books (tenant_id, category_id);
create index books_tenant_title_idx on public.books (tenant_id, title);
create index books_tenant_isbn_idx on public.books (tenant_id, isbn) where isbn is not null;

create trigger set_updated_at before update on public.books
  for each row execute function public.set_updated_at();

alter table public.books enable row level security;

create policy "tenant members view books" on public.books
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "librarians manage books" on public.books
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  );

-- A library member is a student or a staff member (never both). Kept as its
-- own entity (rather than issuing books straight to students/staff) because
-- membership has its own lifecycle: status, a borrowing cap, a join date.
create table public.members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  membership_number text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'expired')),
  max_books integer not null default 3 check (max_books > 0),
  joined_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint members_exactly_one_holder_chk check (
    (student_id is not null and staff_id is null) or (student_id is null and staff_id is not null)
  ),
  unique (tenant_id, membership_number)
);

create unique index members_tenant_student_uk on public.members (tenant_id, student_id) where student_id is not null;
create unique index members_tenant_staff_uk on public.members (tenant_id, staff_id) where staff_id is not null;
create index members_tenant_idx on public.members (tenant_id);

create trigger set_updated_at before update on public.members
  for each row execute function public.set_updated_at();

alter table public.members enable row level security;

create policy "staff roles view members" on public.members
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'librarian', 'accountant')
  );

create policy "members view own membership" on public.members
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and (
      student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
      or staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  );

create policy "librarians manage members" on public.members
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  );

-- Session-scoped per CLAUDE.md rule 2 (a book issued in one academic
-- session is a distinct record from the same book issued again next year).
create table public.book_issues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'issued' check (status in ('issued', 'returned', 'lost')),
  issued_at timestamptz not null default now(),
  due_at date not null,
  returned_at timestamptz,
  fine_amount numeric(10, 2) not null default 0 check (fine_amount >= 0),
  fine_paid boolean not null default false,
  issued_by uuid references auth.users(id) on delete set null,
  returned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index book_issues_tenant_idx on public.book_issues (tenant_id);
create index book_issues_tenant_session_idx on public.book_issues (tenant_id, session_id);
create index book_issues_book_idx on public.book_issues (book_id);
create index book_issues_member_idx on public.book_issues (member_id);
create index book_issues_issued_by_idx on public.book_issues (issued_by);
create index book_issues_returned_by_idx on public.book_issues (returned_by);
create index book_issues_open_idx on public.book_issues (tenant_id, due_at) where status = 'issued';

create trigger set_updated_at before update on public.book_issues
  for each row execute function public.set_updated_at();

alter table public.book_issues enable row level security;

create policy "staff roles view book_issues" on public.book_issues
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'librarian', 'accountant')
  );

create policy "members view own book_issues" on public.book_issues
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and member_id in (
      select m.id from public.members m
      where m.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
         or m.staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  );

create policy "librarians manage book_issues" on public.book_issues
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'librarian')
  );

create trigger audit_book_categories after insert or update or delete on public.book_categories
  for each row execute function public.audit_row_change();
create trigger audit_books after insert or update or delete on public.books
  for each row execute function public.audit_row_change();
create trigger audit_members after insert or update or delete on public.members
  for each row execute function public.audit_row_change();
create trigger audit_book_issues after insert or update or delete on public.book_issues
  for each row execute function public.audit_row_change();

-- Atomic issue: checks availability, decrements the book's available_copies,
-- and inserts the issue row in one statement. SECURITY INVOKER (the
-- default) -- runs as the calling librarian/admin, so their RLS policies
-- decide whether the insert/update is allowed at all; this just makes the
-- two writes atomic and the availability check race-free.
create or replace function public.library_issue_book(
  p_book_id uuid,
  p_member_id uuid,
  p_due_at date default (current_date + interval '14 days')
)
returns public.book_issues
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_available integer;
  v_max_books integer;
  v_open_count integer;
  v_issue public.book_issues;
begin
  select available_copies into v_available from public.books
  where id = p_book_id and tenant_id = v_tenant_id
  for update;

  if v_available is null then
    raise exception 'Book not found';
  end if;
  if v_available < 1 then
    raise exception 'No copies available';
  end if;

  select max_books into v_max_books from public.members
  where id = p_member_id and tenant_id = v_tenant_id and status = 'active';

  if v_max_books is null then
    raise exception 'Member not found or not active';
  end if;

  select count(*) into v_open_count from public.book_issues
  where member_id = p_member_id and status = 'issued';

  if v_open_count >= v_max_books then
    raise exception 'Member has reached their borrowing limit';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  update public.books set available_copies = available_copies - 1
  where id = p_book_id;

  insert into public.book_issues (tenant_id, session_id, book_id, member_id, due_at, issued_by)
  values (v_tenant_id, v_session_id, p_book_id, p_member_id, p_due_at, auth.uid())
  returning * into v_issue;

  return v_issue;
end;
$$;

-- Atomic return: marks the issue returned, restores the book's
-- available_copies, and applies a flat per-day-late fine.
create or replace function public.library_return_book(
  p_issue_id uuid,
  p_fine_per_day numeric default 2.00
)
returns public.book_issues
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_issue public.book_issues;
  v_days_late integer;
begin
  select * into v_issue from public.book_issues
  where id = p_issue_id and tenant_id = v_tenant_id
  for update;

  if v_issue.id is null then
    raise exception 'Issue record not found';
  end if;
  if v_issue.status = 'returned' then
    raise exception 'Already returned';
  end if;

  v_days_late := greatest(0, (current_date - v_issue.due_at));

  update public.book_issues
  set status = 'returned',
      returned_at = now(),
      returned_by = auth.uid(),
      fine_amount = v_days_late * p_fine_per_day
  where id = p_issue_id
  returning * into v_issue;

  update public.books set available_copies = available_copies + 1
  where id = v_issue.book_id;

  return v_issue;
end;
$$;

revoke all on function public.library_issue_book(uuid, uuid, date) from public, anon;
grant execute on function public.library_issue_book(uuid, uuid, date) to authenticated;
revoke all on function public.library_return_book(uuid, numeric) from public, anon;
grant execute on function public.library_return_book(uuid, numeric) to authenticated;
