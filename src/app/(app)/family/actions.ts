"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { listMyChildren, type FamilyChild } from "@/lib/auth/family";
import { photoUrl } from "@/lib/storage/photos";
import { isCurrentArrangement } from "@/lib/validations/arrangements";

/**
 * A family's own pages: the reference's Student and Parent Dashboard (0346).
 *
 * Every read here is either row-owned by the family through RLS or a narrow
 * definer that checks `family_owns_student` before it reads, so another
 * child's id answers nothing or a sentence. The child picker below is a
 * convenience on top of that, not the boundary (rule 4).
 *
 * A member of staff has no children (`family_my_students()` answers `[]`), so
 * every page here tells them it is for families rather than looking empty.
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** The children this login may pick between, and the one the page is about. */
export async function pickChild(requested?: string | null): Promise<{ children: FamilyChild[]; child: FamilyChild | null }> {
  const children = await listMyChildren();
  const child = children.find((c) => c.studentId === requested) ?? children[0] ?? null;
  return { children, child };
}

// ---------------------------------------------------------------------------
// Dashboard

export type FeeLine = {
  feeHeadId: string;
  feeHead: string;
  amount: number;
  frequency: string;
  occurrences: number | null;
  sessionTotal: number | null;
};

export type FamilyHome = {
  photo: string | null;
  sessionName: string | null;
  guardians: { relationship: string; name: string | null; phone: string | null; occupation: string | null; isPrimary: boolean }[];
  fees: { charged: number; concessions: number; paid: number; balance: number };
  feeLines: FeeLine[];
  attendance: { present: number; absent: number; late: number; excused: number; marked: number };
  transport: { route: string; stop: string; vehicle: string | null; fare: number | null; pickup: string | null; drop: string | null } | null;
  notices: { id: string; title: string; body: string; publishedAt: string | null }[];
};

type MobileStudent = {
  fees?: { charged?: number | string; paid?: number | string; balance?: number | string };
  attendance?: { days_present?: number; days_absent?: number; days_late?: number; days_excused?: number; days_marked?: number };
};

export async function getFamilyHome(
  child: FamilyChild,
  session: { id: string | null; name: string | null },
): Promise<FamilyHome> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Rule 11: the published contract already knows the balance and the
  // register; read it rather than computing either a second time.
  const [mobile, structure, guardians, transport, discounts, notices, photo] = await Promise.all([
    supabase.rpc("mobile_student", { p_student_id: child.studentId }),
    supabase.rpc("family_fee_structure", { p_student_id: child.studentId }),
    supabase.rpc("family_guardians", { p_student_id: child.studentId }),
    supabase.rpc("transport_for_student", { p_student_id: child.studentId }),
    supabase
      .from("ledger_entries")
      .select("amount, session_id")
      .eq("student_id", child.studentId)
      .eq("entry_type", "discount")
      // The balance beside it is this year's (fees_student_balances), so the
      // concession must be too.
      .eq("session_id", session.id ?? ""),
    supabase
      .from("notices")
      .select("id, title, body, published_at")
      .eq("status", "published")
      .order("is_pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .order("id")
      .limit(4),
    photoUrl(child.photoPath),
  ]);

  const m = (mobile.data ?? {}) as MobileStudent;
  const num = (v: number | string | undefined | null) => (v === undefined || v === null ? 0 : Number(v));
  const bus = (transport.data ?? []).find((r) => isCurrentArrangement(r, today)) ?? null;

  return {
    photo,
    sessionName: session.name,
    guardians: (guardians.data ?? []).map((g) => ({
      relationship: g.relationship,
      name: g.full_name,
      phone: g.phone,
      occupation: g.occupation,
      isPrimary: g.is_primary,
    })),
    fees: {
      charged: num(m.fees?.charged),
      // Discounts are stored negative (rule 6); a family reads the size of it.
      concessions: Math.abs((discounts.data ?? []).reduce((sum, r) => sum + Number(r.amount), 0)),
      paid: num(m.fees?.paid),
      balance: num(m.fees?.balance),
    },
    feeLines: (structure.data ?? []).map(toFeeLine),
    attendance: {
      present: m.attendance?.days_present ?? 0,
      absent: m.attendance?.days_absent ?? 0,
      late: m.attendance?.days_late ?? 0,
      excused: m.attendance?.days_excused ?? 0,
      marked: m.attendance?.days_marked ?? 0,
    },
    transport: bus
      ? {
          route: bus.route_name,
          stop: bus.stop_name,
          vehicle: bus.registration_number ?? null,
          fare: bus.monthly_fare === null ? null : Number(bus.monthly_fare),
          pickup: bus.pickup_time,
          drop: bus.drop_time,
        }
      : null,
    notices: (notices.data ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body ?? "", publishedAt: n.published_at })),
  };
}

function toFeeLine(r: {
  fee_head_id: string;
  fee_head: string;
  amount: number;
  frequency: string;
  occurrences: number | null;
  session_total: number | null;
}): FeeLine {
  return {
    feeHeadId: r.fee_head_id,
    feeHead: r.fee_head,
    amount: Number(r.amount),
    frequency: r.frequency,
    occurrences: r.occurrences,
    sessionTotal: r.session_total === null ? null : Number(r.session_total),
  };
}

// ---------------------------------------------------------------------------
// Fee structure and payments

export async function getFeeStructure(studentId: string): Promise<{ lines: FeeLine[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("family_fee_structure", { p_student_id: studentId });
  return { lines: (data ?? []).map(toFeeLine), error: error?.message ?? null };
}

export type PaymentRow = {
  id: string;
  receiptNumber: string | null;
  amount: number;
  method: string | null;
  reference: string | null;
  occurredAt: string;
  invoiceNumber: string | null;
  isRefund: boolean;
};

export async function getPayments(studentId: string): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ledger_entries")
    .select("id, receipt_number, amount, method, reference, occurred_at, entry_type, invoice_id")
    .eq("student_id", studentId)
    .in("entry_type", ["payment", "refund"])
    .order("occurred_at", { ascending: false })
    .order("id")
    .limit(500);
  const rows = data ?? [];
  const invoiceIds = [...new Set(rows.map((r) => r.invoice_id).filter((v): v is string => !!v))];
  const { data: invoices } = invoiceIds.length
    ? await supabase.from("invoices").select("id, invoice_number").in("id", invoiceIds)
    : { data: [] as { id: string; invoice_number: string }[] };
  const numberOf = new Map((invoices ?? []).map((i) => [i.id, i.invoice_number]));
  return rows.map((e) => ({
    id: e.id,
    receiptNumber: e.receipt_number,
    // Payments are stored negative (they lower what is owed); show the money.
    amount: Math.abs(Number(e.amount)),
    method: e.method,
    reference: e.reference,
    occurredAt: e.occurred_at,
    invoiceNumber: e.invoice_id ? (numberOf.get(e.invoice_id) ?? null) : null,
    isRefund: e.entry_type === "refund",
  }));
}

// ---------------------------------------------------------------------------
// Books

export type LoanRow = {
  id: string;
  title: string;
  author: string | null;
  bookNumber: string | null;
  issuedAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  status: string;
  fine: number | null;
};

export async function getLoans(studentId: string): Promise<{ cardNumber: string | null; loans: LoanRow[] }> {
  const supabase = await createClient();
  const { data: card } = await supabase
    .from("members")
    .select("id, membership_number")
    .eq("student_id", studentId)
    .order("joined_at", { ascending: false })
    .order("id")
    .limit(1)
    .maybeSingle();
  if (!card) return { cardNumber: null, loans: [] };
  const { data } = await supabase
    .from("book_issues")
    .select("id, book_id, issued_at, due_at, returned_at, status, fine_amount")
    .eq("member_id", card.id)
    .order("issued_at", { ascending: false })
    .order("id")
    .limit(500);
  const rows = data ?? [];
  const bookIds = [...new Set(rows.map((r) => r.book_id))];
  const { data: books } = bookIds.length
    ? await supabase.from("books").select("id, title, author, book_number").in("id", bookIds)
    : { data: [] as { id: string; title: string; author: string | null; book_number: string | null }[] };
  const bookOf = new Map((books ?? []).map((b) => [b.id, b]));
  return {
    cardNumber: card.membership_number,
    loans: rows.map((r) => {
      const b = bookOf.get(r.book_id);
      return {
        id: r.id,
        title: b?.title ?? "",
        author: b?.author ?? null,
        bookNumber: b?.book_number ?? null,
        issuedAt: r.issued_at,
        dueAt: r.due_at,
        returnedAt: r.returned_at,
        status: r.status,
        fine: r.fine_amount === null ? null : Number(r.fine_amount),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Exams

export type ExamPaper = {
  examId: string;
  examName: string;
  examStatus: string;
  centre: string | null;
  startsOn: string | null;
  endsOn: string | null;
  paperId: string;
  subject: string;
  code: string | null;
  date: string | null;
  startsAt: string | null;
  endsAt: string | null;
  slot: string | null;
  maxMarks: number;
  room: string | null;
  seatNo: number | null;
};

export type ExamWithPapers = Omit<ExamPaper, "paperId" | "subject" | "code" | "date" | "startsAt" | "endsAt" | "slot" | "maxMarks" | "room" | "seatNo"> & {
  papers: Pick<ExamPaper, "paperId" | "subject" | "code" | "date" | "startsAt" | "endsAt" | "slot" | "maxMarks" | "room" | "seatNo">[];
};

export async function getExams(studentId: string): Promise<ExamWithPapers[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("family_exam_papers", { p_student_id: studentId });
  const byExam = new Map<string, ExamWithPapers>();
  for (const r of data ?? []) {
    let exam = byExam.get(r.exam_id);
    if (!exam) {
      exam = {
        examId: r.exam_id,
        examName: r.exam_name,
        examStatus: r.exam_status,
        centre: r.centre,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        papers: [],
      };
      byExam.set(r.exam_id, exam);
    }
    exam.papers.push({
      paperId: r.exam_subject_id,
      subject: r.subject,
      code: r.code,
      date: r.exam_date,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      slot: r.slot,
      maxMarks: Number(r.max_marks),
      room: r.room,
      seatNo: r.seat_no,
    });
  }
  return [...byExam.values()];
}

// ---------------------------------------------------------------------------
// Certificates

export type CertificateRow = { id: string; serialNo: string | null; name: string; issuedOn: string; status: string };

export async function getCertificates(studentId: string): Promise<CertificateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("certificates")
    .select("id, serial_no, template_name, issued_on, status")
    .eq("student_id", studentId)
    .order("issued_on", { ascending: false })
    .order("id")
    .limit(200);
  return (data ?? []).map((c) => ({
    id: c.id,
    serialNo: c.serial_no,
    name: c.template_name,
    issuedOn: c.issued_on,
    status: c.status,
  }));
}

// ---------------------------------------------------------------------------
// Attendance

export type AttendanceMonth = { month: string; marked: number; present: number; absent: number; late: number; excused: number };
export type AttendanceDay = { date: string; status: string; note: string | null };

/**
 * The child's own register this year: a line a month, and the days of one
 * month. Over what was marked, never over the calendar, because a register
 * nobody took is not an absence (rule 12, "a rate hides what was never
 * measured").
 */
export async function getAttendance(
  studentId: string,
  month: string | null,
): Promise<{ months: AttendanceMonth[]; days: AttendanceDay[]; month: string | null }> {
  const supabase = await createClient();
  const { data: session } = await supabase.from("academic_sessions").select("id").eq("is_current", true).maybeSingle();
  if (!session) return { months: [], days: [], month };
  const { data: enrolment } = await supabase
    .from("enrolments")
    .select("id")
    .eq("student_id", studentId)
    .eq("session_id", session.id)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (!enrolment) return { months: [], days: [], month };

  const { data } = await supabase
    .from("attendance_records")
    .select("attendance_date, status, note")
    .eq("enrolment_id", enrolment.id)
    .eq("period", 0)
    .order("attendance_date", { ascending: true })
    .limit(400);

  const rows = data ?? [];
  const months = new Map<string, AttendanceMonth>();
  for (const r of rows) {
    const key = r.attendance_date.slice(0, 7);
    const m = months.get(key) ?? { month: key, marked: 0, present: 0, absent: 0, late: 0, excused: 0 };
    m.marked += 1;
    if (r.status === "present" || r.status === "absent" || r.status === "late" || r.status === "excused") m[r.status] += 1;
    months.set(key, m);
  }
  const list = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  const chosen = month && /^\d{4}-\d{2}$/.test(month) ? month : (list[0]?.month ?? null);
  return {
    months: list,
    month: chosen,
    days: chosen
      ? rows.filter((r) => r.attendance_date.startsWith(chosen)).map((r) => ({ date: r.attendance_date, status: r.status, note: r.note }))
      : [],
  };
}

// ---------------------------------------------------------------------------
// Stationery bought

export type PurchaseRow = { id: string; item: string; unit: string | null; quantity: number; unitPrice: number; total: number; on: string };

export async function getPurchases(studentId: string): Promise<PurchaseRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_movements")
    .select("id, item_id, quantity, unit_price, happened_on")
    .eq("kind", "sale")
    .eq("sold_to_student_id", studentId)
    .order("happened_on", { ascending: false })
    .order("id")
    .limit(500);
  const rows = data ?? [];
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  const { data: items } = itemIds.length
    ? await supabase.from("inventory_items").select("id, name, unit").in("id", itemIds)
    : { data: [] as { id: string; name: string; unit: string | null }[] };
  const itemOf = new Map((items ?? []).map((i) => [i.id, i]));
  return rows.map((r) => {
    const item = itemOf.get(r.item_id);
    const quantity = Math.abs(Number(r.quantity));
    const unitPrice = Number(r.unit_price ?? 0);
    return { id: r.id, item: item?.name ?? "", unit: item?.unit ?? null, quantity, unitPrice, total: quantity * unitPrice, on: r.happened_on };
  });
}

// ---------------------------------------------------------------------------
// Contact details

export type ContactDetails = {
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export async function getContact(studentId: string): Promise<ContactDetails | null> {
  const supabase = await createClient();
  const { data: student } = await supabase.from("students").select("person_id").eq("id", studentId).maybeSingle();
  if (!student) return null;
  const { data: p } = await supabase
    .from("people")
    .select("phone, email, address_line1, address_line2, city, state, postal_code, country")
    .eq("id", student.person_id)
    .maybeSingle();
  if (!p) return null;
  return {
    phone: p.phone ?? "",
    email: (p.email as string | null) ?? "",
    addressLine1: p.address_line1 ?? "",
    addressLine2: p.address_line2 ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    postalCode: p.postal_code ?? "",
    country: p.country ?? "",
  };
}

export async function updateChildContact(
  studentId: string,
  input: Omit<ContactDetails, "email">,
): Promise<ActionResult> {
  if (input.phone.length > 20 || input.addressLine1.length > 200 || input.addressLine2.length > 200) {
    return { ok: false, error: "One of the fields is too long." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("family_update_contact", {
    p_student_id: studentId,
    p_phone: input.phone || null,
    p_address_line1: input.addressLine1 || null,
    p_address_line2: input.addressLine2 || null,
    p_city: input.city || null,
    p_state: input.state || null,
    p_postal_code: input.postalCode || null,
    p_country: input.country || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/family/profile");
  return { ok: true, data: undefined };
}

export async function updateMyContact(input: { phone: string; occupation: string }): Promise<ActionResult> {
  if (input.phone.length > 20 || input.occupation.length > 100) return { ok: false, error: "One of the fields is too long." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("family_update_my_contact", {
    p_phone: input.phone || null,
    p_occupation: input.occupation || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/family/profile");
  return { ok: true, data: undefined };
}
