"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { bookSchema, issueBookSchema, memberSchema } from "@/lib/validations/library";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type ListParams = {
  pageIndex: number;
  pageSize: number;
  sortBy?: string;
  sortDesc?: boolean;
  search?: string;
  categoryId?: string;
  status?: string;
};

export type BookRow = {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  publisher: string | null;
  shelfLocation: string | null;
  categoryName: string | null;
  totalCopies: number;
  availableCopies: number;
};

const BOOK_SORT_COLUMNS = new Set(["title", "author", "total_copies", "available_copies", "created_at"]);

export async function listBooks(params: ListParams): Promise<{ rows: BookRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, sortBy, sortDesc, search, categoryId } = params;

  let query = supabase
    .from("books")
    .select("id, title, author, isbn, publisher, shelf_location, total_copies, available_copies, book_categories ( name )", {
      count: "exact",
    });

  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    query = query.or(`title.ilike.${like},author.ilike.${like},isbn.ilike.${like}`);
  }
  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }

  const orderColumn = sortBy && BOOK_SORT_COLUMNS.has(sortBy) ? sortBy : "title";
  query = query
    .order(orderColumn, { ascending: !sortDesc })
    .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      publisher: b.publisher,
      shelfLocation: b.shelf_location,
      categoryName: b.book_categories?.name ?? null,
      totalCopies: b.total_copies,
      availableCopies: b.available_copies,
    })),
    total: count ?? 0,
  };
}

export async function listCategories() {
  const supabase = await createClient();
  const { data } = await supabase.from("book_categories").select("id, name").order("name");
  return data ?? [];
}

export async function createBook(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("books")
    .insert({
      // tenant_id is still checked by RLS -- this just satisfies NOT NULL.
      tenant_id: ctx.tenantId,
      title: parsed.data.title,
      author: parsed.data.author,
      category_id: parsed.data.categoryId || null,
      isbn: parsed.data.isbn || null,
      publisher: parsed.data.publisher || null,
      edition: parsed.data.edition || null,
      shelf_location: parsed.data.shelfLocation || null,
      total_copies: parsed.data.totalCopies,
      available_copies: parsed.data.totalCopies,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/library/books");
  return { ok: true, data: { id: data.id } };
}

export async function updateBook(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from("books")
    .select("total_copies, available_copies")
    .eq("id", id)
    .single();

  if (readError) return { ok: false, error: readError.message };

  // Keep available_copies consistent when the total changes: apply the same
  // delta, never letting it fall below zero or exceed the new total.
  const delta = parsed.data.totalCopies - existing.total_copies;
  const nextAvailable = Math.min(
    parsed.data.totalCopies,
    Math.max(0, existing.available_copies + delta),
  );

  const { error } = await supabase
    .from("books")
    .update({
      title: parsed.data.title,
      author: parsed.data.author,
      category_id: parsed.data.categoryId || null,
      isbn: parsed.data.isbn || null,
      publisher: parsed.data.publisher || null,
      edition: parsed.data.edition || null,
      shelf_location: parsed.data.shelfLocation || null,
      total_copies: parsed.data.totalCopies,
      available_copies: nextAvailable,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/library/books");
  revalidatePath(`/library/books/${id}`);
  return { ok: true, data: { id } };
}

export async function deleteBook(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/library/books");
  return { ok: true, data: undefined };
}

export type MemberRow = {
  id: string;
  membershipNumber: string;
  holderName: string;
  holderType: "Student" | "Staff";
  holderRef: string;
  status: string;
  maxBooks: number;
  booksOut: number;
};

export async function listMembers(params: ListParams): Promise<{ rows: MemberRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, search, status } = params;

  let query = supabase
    .from("members")
    .select(
      `id, membership_number, status, max_books,
       students ( admission_number, people:person_id ( first_name, last_name ) ),
       staff ( employee_code, people:person_id ( first_name, last_name ) ),
       book_issues ( id, status )`,
      { count: "exact" },
    );

  if (search && search.trim()) {
    query = query.ilike("membership_number", `%${search.trim()}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }

  query = query
    .order("membership_number", { ascending: true })
    .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((m) => {
      const isStudent = !!m.students;
      const person = m.students?.people ?? m.staff?.people;
      return {
        id: m.id,
        membershipNumber: m.membership_number,
        holderName: person ? `${person.first_name} ${person.last_name}` : "—",
        holderType: isStudent ? ("Student" as const) : ("Staff" as const),
        holderRef: m.students?.admission_number ?? m.staff?.employee_code ?? "—",
        status: m.status,
        maxBooks: m.max_books,
        booksOut: (m.book_issues ?? []).filter((i) => i.status === "issued").length,
      };
    }),
    total: count ?? 0,
  };
}

export async function createMember(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .insert({
      tenant_id: ctx.tenantId,
      student_id: parsed.data.holderType === "student" ? parsed.data.holderId : null,
      staff_id: parsed.data.holderType === "staff" ? parsed.data.holderId : null,
      membership_number: parsed.data.membershipNumber,
      max_books: parsed.data.maxBooks,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That membership number, student, or staff member already has a membership." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/library/members");
  return { ok: true, data: { id: data.id } };
}

export type IssueRow = {
  id: string;
  bookTitle: string;
  bookId: string;
  memberName: string;
  membershipNumber: string;
  status: string;
  issuedAt: string;
  dueAt: string;
  returnedAt: string | null;
  fineAmount: number;
  isOverdue: boolean;
  daysLate: number;
  /**
   * What the fine would be if the book came back today. Only meaningful while
   * the issue is still open -- nothing is booked until the book is returned,
   * because a growing debt cannot be one immutable ledger entry.
   */
  accruedFine: number;
  /** True once this fine has been booked to the student's fee account. */
  billedToFees: boolean;
  /** Set when the member is a student, so the ledger can be linked to. */
  studentId: string | null;
};

/**
 * The per-day fine, from `settings`, so the estimate shown in the library and
 * the amount `library_return_book()` actually charges come from one place.
 * Falls back to the historical default if a tenant has no row.
 */
export async function getFinePerDay(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "library.fine_per_day")
    .maybeSingle();

  const amount = (data?.value as { amount?: number } | null)?.amount;
  return typeof amount === "number" ? amount : 2;
}

export async function listIssues(params: ListParams): Promise<{ rows: IssueRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, search, status } = params;

  const finePerDay = await getFinePerDay();

  let query = supabase
    .from("book_issues")
    .select(
      `id, status, issued_at, due_at, returned_at, fine_amount,
       books ( id, title ),
       members ( membership_number, student_id,
                 students ( people:person_id ( first_name, last_name ) ),
                 staff ( people:person_id ( first_name, last_name ) ) )`,
      { count: "exact" },
    );

  const today = new Date().toISOString().slice(0, 10);
  if (status === "overdue") {
    query = query.eq("status", "issued").lt("due_at", today);
  } else if (status) {
    query = query.eq("status", status);
  }

  query = query
    .order("issued_at", { ascending: false })
    .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  // Which of these fines actually reached a fee account. A separate query
  // rather than an embed: `ledger_entries -> book_issues` is a composite
  // (tenant_id, book_issue_id) foreign key, and embedding across one is not
  // something this project can verify from its test environment.
  const issueIds = (data ?? []).map((i) => i.id);
  let billedIssueIds = new Set<string>();

  if (issueIds.length > 0) {
    const { data: booked } = await supabase
      .from("ledger_entries")
      .select("book_issue_id")
      .in("book_issue_id", issueIds)
      .is("reverses_entry_id", null);

    billedIssueIds = new Set(
      (booked ?? []).map((e) => e.book_issue_id).filter(Boolean) as string[],
    );
  }

  let rows = (data ?? []).map((i) => {
    const person = i.members?.students?.people ?? i.members?.staff?.people;
    const isOverdue = i.status === "issued" && i.due_at < today;
    const daysLate = Math.max(
      0,
      Math.round(
        (Date.parse(i.status === "returned" && i.returned_at ? i.returned_at : today) -
          Date.parse(i.due_at)) /
          86_400_000,
      ),
    );

    return {
      id: i.id,
      bookId: i.books?.id ?? "",
      bookTitle: i.books?.title ?? "—",
      memberName: person ? `${person.first_name} ${person.last_name}` : "—",
      membershipNumber: i.members?.membership_number ?? "—",
      status: i.status,
      issuedAt: i.issued_at,
      dueAt: i.due_at,
      returnedAt: i.returned_at,
      fineAmount: Number(i.fine_amount),
      isOverdue,
      daysLate,
      accruedFine: isOverdue ? daysLate * finePerDay : 0,
      billedToFees: billedIssueIds.has(i.id),
      studentId: i.members?.student_id ?? null,
    };
  });

  if (search && search.trim()) {
    const needle = search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.bookTitle.toLowerCase().includes(needle) ||
        r.memberName.toLowerCase().includes(needle) ||
        r.membershipNumber.toLowerCase().includes(needle),
    );
  }

  return { rows, total: count ?? 0 };
}

export async function issueBook(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = issueBookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("library_issue_book", {
    p_book_id: parsed.data.bookId,
    p_member_id: parsed.data.memberId,
    p_due_at: parsed.data.dueAt,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/library/issues");
  revalidatePath("/library/books");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Returning a late book now books a `fine` entry against the student's fee
 * account inside the same transaction, so the toast can say where the money
 * went. A staff member has no fee account, so their fine stays on the issue
 * row -- the caller is told which happened rather than left to guess.
 */
export async function returnBook(
  issueId: string,
): Promise<ActionResult<{ fineAmount: number; billedToFees: boolean; studentId: string | null }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("library_return_book", { p_issue_id: issueId });

  if (error) return { ok: false, error: error.message };

  const fineAmount = Number(data.fine_amount);

  let billedToFees = false;
  let studentId: string | null = null;

  if (fineAmount > 0) {
    const { data: entry } = await supabase
      .from("ledger_entries")
      .select("student_id")
      .eq("book_issue_id", issueId)
      .is("reverses_entry_id", null)
      .maybeSingle();

    billedToFees = entry !== null;
    studentId = entry?.student_id ?? null;
  }

  revalidatePath("/library/issues");
  revalidatePath("/library/books");
  revalidatePath("/fees");
  if (studentId) revalidatePath(`/fees/students/${studentId}`);

  return { ok: true, data: { fineAmount, billedToFees, studentId } };
}

export async function listIssuableMembers(search: string) {
  const supabase = await createClient();
  let query = supabase
    .from("members")
    .select(
      `id, membership_number,
       students ( people:person_id ( first_name, last_name ) ),
       staff ( people:person_id ( first_name, last_name ) )`,
    )
    .eq("status", "active")
    .order("membership_number")
    .limit(20);

  if (search.trim()) {
    query = query.ilike("membership_number", `%${search.trim()}%`);
  }

  const { data } = await query;
  return (data ?? []).map((m) => {
    const person = m.students?.people ?? m.staff?.people;
    return {
      id: m.id,
      label: `${m.membership_number} · ${person ? `${person.first_name} ${person.last_name}` : "—"}`,
    };
  });
}
