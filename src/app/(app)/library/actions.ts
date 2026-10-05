"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { bookSchema, issueBookSchema, memberSchema } from "@/lib/validations/library";
import { deleteErrorSentence, nothingDeletedSentence } from "@/lib/validations/errors";

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
  bookNumber: string | null;
  price: number | null;
};

const BOOK_SORT_COLUMNS = new Set([
  "title",
  "author",
  "total_copies",
  "available_copies",
  "created_at",
  "book_number",
  "price",
  "shelf_location",
]);

export async function listBooks(params: ListParams): Promise<{ rows: BookRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, sortBy, sortDesc, search, categoryId } = params;

  // The two filters go into `library_catalogue` (0337; `library_books` before
  // it, 0259) and the paging
  // stays here: PostgREST applies `.order()`, `.range()` and `count: exact` to
  // a set-returning function exactly as it does to a table, which is the idiom
  // `fees_student_balances` already established. What this replaced was
  //
  //   .or(`title.ilike.${like},author.ilike.${like},isbn.ilike.${like}`)
  //
  // — a filter language with a borrower's typing spliced into it, so a search
  // for `Gödel, Escher, Bach` closes the group early. The sort column is still
  // whitelisted here, because that one is a client-supplied *identifier* and
  // no bound parameter can carry it.
  const orderColumn = sortBy && BOOK_SORT_COLUMNS.has(sortBy) ? sortBy : "title";

  const { data, count, error } = await supabase
    .rpc(
      "library_catalogue",
      { p_query: search?.trim() || "", p_category_id: categoryId || undefined },
      { count: "exact" },
    )
    .order(orderColumn, { ascending: !sortDesc })
    // A tiebreak, because `total_copies` is 5 distinct values over 21 books and
    // a set-returning function has no order of its own to fall back on.
    .order("id", { ascending: true })
    .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);
  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      publisher: b.publisher,
      shelfLocation: b.shelf_location,
      categoryName: b.category_name,
      totalCopies: b.total_copies,
      availableCopies: b.available_copies,
      bookNumber: b.book_number,
      price: b.price,
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
      book_number: parsed.data.bookNumber?.trim() || null,
      price: parsed.data.price ?? null,
      total_copies: parsed.data.totalCopies,
      available_copies: parsed.data.totalCopies,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Another book already has that book number.",
        fieldErrors: { bookNumber: ["Already in use"] },
      };
    }
    return { ok: false, error: error.message };
  }

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

  const { data: updated, error } = await supabase
    .from("books")
    .update({
      title: parsed.data.title,
      author: parsed.data.author,
      category_id: parsed.data.categoryId || null,
      isbn: parsed.data.isbn || null,
      publisher: parsed.data.publisher || null,
      edition: parsed.data.edition || null,
      shelf_location: parsed.data.shelfLocation || null,
      book_number: parsed.data.bookNumber?.trim() || null,
      price: parsed.data.price ?? null,
      total_copies: parsed.data.totalCopies,
      available_copies: nextAvailable,
    })
    .eq("id", id)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Another book already has that book number.",
        fieldErrors: { bookNumber: ["Already in use"] },
      };
    }
    return { ok: false, error: error.message };
  }
  // An update no policy matches writes nothing and raises nothing (rule 6).
  if (!updated?.length) return { ok: false, error: "This book could not be changed. It may have been deleted, or your role may not edit the catalogue." };

  revalidatePath("/library/books");
  revalidatePath(`/library/books/${id}`);
  return { ok: true, data: { id } };
}

export async function deleteBook(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("books").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: deleteErrorSentence(error, "this book") };
  if (!data?.length) return { ok: false, error: nothingDeletedSentence("this book") };

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
  /** The day the card was issued. */
  joinedAt: string;
  /** A student's class and section this year; null for staff or a child not enrolled. */
  className: string | null;
  sectionName: string | null;
};

export async function listMembers(params: ListParams): Promise<{ rows: MemberRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, search, status } = params;

  let query = supabase
    .from("members")
    .select(
      `id, membership_number, status, max_books, joined_at, student_id,
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

  const placed = await currentClassOf(
    supabase,
    (data ?? []).map((m) => m.student_id).filter((id): id is string => !!id),
  );

  return {
    rows: (data ?? []).map((m) => {
      const isStudent = !!m.students;
      const where = m.student_id ? placed.get(m.student_id) : undefined;
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
        joinedAt: m.joined_at,
        className: where?.className ?? null,
        sectionName: where?.sectionName ?? null,
      };
    }),
    total: count ?? 0,
  };
}

/** One card, for printing. Read by id through RLS: null when it is not there or not the caller's. */
export async function getMemberCard(id: string): Promise<MemberRow | null> {
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("members")
    .select(
      `id, membership_number, status, max_books, joined_at, student_id,
       students ( admission_number, people:person_id ( first_name, last_name ) ),
       staff ( employee_code, people:person_id ( first_name, last_name ) ),
       book_issues ( id, status )`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!m) return null;
  const placed = await currentClassOf(supabase, m.student_id ? [m.student_id] : []);
  const where = m.student_id ? placed.get(m.student_id) : undefined;
  const person = m.students?.people ?? m.staff?.people;
  return {
    id: m.id,
    membershipNumber: m.membership_number,
    holderName: person ? `${person.first_name} ${person.last_name}` : "—",
    holderType: m.students ? "Student" : "Staff",
    holderRef: m.students?.admission_number ?? m.staff?.employee_code ?? "—",
    status: m.status,
    maxBooks: m.max_books,
    booksOut: (m.book_issues ?? []).filter((i) => i.status === "issued").length,
    joinedAt: m.joined_at,
    className: where?.className ?? null,
    sectionName: where?.sectionName ?? null,
  };
}

/**
 * Each student's class and section in the current year, for the cards on one
 * page. Three plain reads rather than embeds: `enrolments` reaches `sections`
 * through a composite key. The year comes from the server (rule 2).
 */
async function currentClassOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  studentIds: string[],
): Promise<Map<string, { className: string | null; sectionName: string }>> {
  const out = new Map<string, { className: string | null; sectionName: string }>();
  if (studentIds.length === 0) return out;
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return out;
  const { data: enrolled } = await supabase
    .from("enrolments")
    .select("student_id, section_id")
    .eq("session_id", ctx.currentSessionId)
    .eq("status", "active")
    .in("student_id", studentIds);
  const sectionIds = [...new Set((enrolled ?? []).map((e) => e.section_id))];
  if (sectionIds.length === 0) return out;
  const { data: sections } = await supabase
    .from("sections")
    .select("id, name, class_level_id")
    .in("id", sectionIds);
  const levelIds = [...new Set((sections ?? []).map((s) => s.class_level_id))];
  const { data: levels } = await supabase.from("class_levels").select("id, name").in("id", levelIds);
  const levelName = new Map((levels ?? []).map((l) => [l.id, l.name]));
  const section = new Map((sections ?? []).map((s) => [s.id, s]));
  for (const e of enrolled ?? []) {
    const s = section.get(e.section_id);
    if (s) out.set(e.student_id, { className: levelName.get(s.class_level_id) ?? null, sectionName: s.name });
  }
  return out;
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
  bookAuthor: string | null;
  bookNumber: string | null;
  rackNumber: string | null;
  memberName: string;
  membershipNumber: string;
  /** Admission number for a student, employee code for staff. */
  holderRef: string | null;
  className: string | null;
  sectionName: string | null;
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
  /** True when the member is staff -- their fine settles through payroll, not fees. */
  isStaff: boolean;
  /** A staff fine that has been collected on a payslip, or written off. */
  staffFineSettled: boolean;
  staffFineWaived: boolean;
};

/**
 * The per-day fine, so the estimate shown in the library and the amount
 * `library_return_book()` actually charges come from one place — now literally
 * one function rather than three that agree. See migration 0167.
 */
export async function getFinePerDay(): Promise<number> {
  const supabase = await createClient();
  // `setting_number` is the only place a default is applied — migration 0167
  // deleted the four other copies of 2.00, this one included. A literal here
  // would be the fifth answer again.
  const { data } = await supabase.rpc("setting_number", {
    p_key: "library.fine_per_day",
    p_field: "amount",
  });

  const amount = typeof data === "string" ? Number(data) : data;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
}

export async function listIssues(params: ListParams): Promise<{ rows: IssueRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, search, status } = params;

  const finePerDay = await getFinePerDay();

  let query = supabase
    .from("book_issues")
    .select(
      `id, status, issued_at, due_at, returned_at, fine_amount,
       staff_fine_payslip_id, staff_fine_waived_at,
       books ( id, title, author, book_number, shelf_location ),
       members ( membership_number, student_id, staff_id,
                 students ( admission_number, people:person_id ( first_name, last_name ) ),
                 staff ( employee_code, people:person_id ( first_name, last_name ) ) )`,
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
    // 26 issues over 4 distinct timestamps: a bulk issue gives a whole class
    // the same `issued_at`, so this is the column most likely to tie.
    .order("id", { ascending: true })
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

  const placed = await currentClassOf(
    supabase,
    [...new Set((data ?? []).map((i) => i.members?.student_id).filter((id): id is string => !!id))],
  );

  let rows = (data ?? []).map((i) => {
    const person = i.members?.students?.people ?? i.members?.staff?.people;
    const where = i.members?.student_id ? placed.get(i.members.student_id) : undefined;
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
      bookAuthor: i.books?.author ?? null,
      bookNumber: i.books?.book_number ?? null,
      rackNumber: i.books?.shelf_location ?? null,
      memberName: person ? `${person.first_name} ${person.last_name}` : "—",
      membershipNumber: i.members?.membership_number ?? "—",
      holderRef: i.members?.students?.admission_number ?? i.members?.staff?.employee_code ?? null,
      className: where?.className ?? null,
      sectionName: where?.sectionName ?? null,
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
      isStaff: i.members?.staff_id != null,
      staffFineSettled: i.staff_fine_payslip_id != null,
      staffFineWaived: i.staff_fine_waived_at != null,
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

/**
 * Write off a staff library fine. A student's fine goes to the fee ledger at
 * return time (migration 0026); a staff member's has nowhere to go there --
 * `ledger_entries.student_id` is not null -- so it is either collected on a
 * payslip (migration 0065) or waived here. A waiver records who and when
 * rather than zeroing the amount, because the amount is what was owed and the
 * lateness is a fact worth keeping.
 */
export async function waiveStaffFine(issueId: string, note?: string): Promise<ActionResult> {
  const supabase = await createClient();
  // `p_note` has been in this signature since 0066 and was never passed. It is
  // stored now (0220), so the screen asks for it -- optional, because the
  // amount, the who and the when are the record and refusing a write-off for
  // want of a sentence is a function schools route around.
  const { error } = await supabase.rpc("library_waive_staff_fine", {
    p_issue_id: issueId,
    p_note: note?.trim() || undefined,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/library/issues");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Members and categories (0289)
// ---------------------------------------------------------------------------
//
// `createMember` existed and nothing called it: a college could not add a
// borrower, so a new college's library could never lend. And a card could
// only close through a formal leaving. These are the screens' halves; the
// "librarians manage" policies are the gate, and every write asserts that a
// row was written, because a write no policy matches raises nothing.

/** Find a child to give a library card. The one definition, `student_search`. */
export async function searchStudentsForLibrary(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", { p_query: needle, p_limit: 10 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.full_name,
    admissionNumber: s.admission_number,
    status: s.status,
  }));
}

/** Current staff, for a staff card. A college's staff is bounded by its size. */
export async function listStaffForLibrary(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff")
    .select("id, employee_code, people:person_id ( first_name, last_name )")
    .eq("status", "active")
    .order("employee_code");
  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.people ? `${s.people.first_name} ${s.people.last_name} · ${s.employee_code}` : s.employee_code,
  }));
}

/** A suggestion, not a rule: the next number after the highest in use. */
export async function nextMembershipNumber(): Promise<string> {
  const supabase = await createClient();
  const { count } = await supabase.from("members").select("id", { count: "exact", head: true });
  return `LIB-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

export async function setMemberStatus(
  id: string,
  status: "active" | "suspended",
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").update({ status }).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Only the library can change a card." };
  revalidatePath("/library/members");
  return { ok: true, data: undefined };
}

export async function saveBookCategory(name: string, id?: string): Promise<ActionResult<{ id: string }>> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) return { ok: false, error: "Give the category a name." };
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("book_categories").update({ name: trimmed }).eq("id", id).select("id")
    : await supabase.from("book_categories").insert({ name: trimmed, tenant_id: ctx.tenantId }).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "There is already a category with that name." };
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: "Only the library can change categories." };
  revalidatePath("/library/books");
  return { ok: true, data: { id: data[0].id } };
}

/** Books in it keep their place in the catalogue, uncategorised. */
export async function deleteBookCategory(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("book_categories").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Only the library can change categories." };
  revalidatePath("/library/books");
  return { ok: true, data: undefined };
}

export type IssuePick = { id: string; label: string; detail: string };

/**
 * A borrower by card number, name, admission number or employee code, for the
 * issue dialog (0292). Replaces a list of the first twenty cards, which is all
 * the dialog could ever offer on a roll of three hundred.
 */
export async function searchMembersForIssue(term: string): Promise<IssuePick[]> {
  if (term.trim().length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("library_member_search", { p_query: term.trim(), p_limit: 12 });
  return (data ?? []).map((m) => ({
    id: m.id,
    label: m.full_name,
    detail: [m.membership_number, m.kind === "staff" ? "Staff" : "Student", m.reference]
      .filter(Boolean)
      .join(" · "),
  }));
}

/** A book with a copy on the shelf, by title, author, ISBN or book number -- `library_catalogue`, the catalogue's own search. */
export async function searchBooksForIssue(term: string): Promise<IssuePick[]> {
  if (term.trim().length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("library_catalogue", { p_query: term.trim() })
    .gt("available_copies", 0)
    .order("title")
    .order("id")
    .limit(12);
  return (data ?? []).map((b) => ({
    id: b.id,
    label: b.title,
    detail: [b.book_number ? `No. ${b.book_number}` : null, b.author, `${b.available_copies} on the shelf`]
      .filter(Boolean)
      .join(" · "),
  }));
}
