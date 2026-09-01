"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  adjustmentSchema,
  cancelInvoiceSchema,
  feeHeadSchema,
  feeStructureSchema,
  generateInvoiceSchema,
  generateSectionInvoicesSchema,
  paymentSchema,
  refundSchema,
  reversalSchema,
} from "@/lib/validations/fees";
import type { ActionResult } from "../library/actions";

export type BalanceRow = {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  sectionLabel: string | null;
  rollNumber: string | null;
  charged: number;
  fines: number;
  discounts: number;
  writeOffs: number;
  paid: number;
  refunds: number;
  balance: number;
  lastPaymentAt: string | null;
};

/**
 * Balances come from `fees_student_balances()` rather than being assembled
 * here: the sums are over two tables for every enrolled student, and doing it
 * in the request would mean pulling the whole ledger across the wire to add it
 * up in JavaScript. The function is SECURITY INVOKER, so RLS still decides
 * which students the caller sees.
 *
 * PostgREST applies `.order()` and `.range()` to a set-returning function the
 * same way it does to a table, so sorting and paging stay server-side.
 */
const BALANCE_SORT_COLUMNS = new Set([
  "full_name",
  "admission_number",
  "balance",
  "charged",
  "paid",
  "last_payment_at",
]);

export async function listBalances(params: {
  pageIndex: number;
  pageSize: number;
  sortBy?: string;
  sortDesc?: boolean;
  sectionId?: string;
  onlyOutstanding?: boolean;
}): Promise<{ rows: BalanceRow[]; total: number }> {
  const supabase = await createClient();
  const { pageIndex, pageSize, sortBy, sortDesc, sectionId, onlyOutstanding } = params;

  const orderColumn = sortBy && BALANCE_SORT_COLUMNS.has(sortBy) ? sortBy : "full_name";

  const { data, count, error } = await supabase
    .rpc(
      "fees_student_balances",
      {
        p_section_id: sectionId || undefined,
        p_only_outstanding: onlyOutstanding ?? false,
      },
      { count: "exact" },
    )
    .order(orderColumn, { ascending: !sortDesc, nullsFirst: false })
    .range(pageIndex * pageSize, pageIndex * pageSize + pageSize - 1);

  if (error) throw new Error(error.message);

  return {
    rows: (data ?? []).map((r) => ({
      studentId: r.student_id,
      admissionNumber: r.admission_number,
      fullName: r.full_name,
      sectionLabel: r.section_label,
      rollNumber: r.roll_number,
      charged: Number(r.charged),
      fines: Number(r.fines),
      discounts: Number(r.discounts),
      writeOffs: Number(r.write_offs),
      paid: Number(r.paid),
      refunds: Number(r.refunds),
      balance: Number(r.balance),
      lastPaymentAt: r.last_payment_at,
    })),
    total: count ?? 0,
  };
}

/** Totals for the header cards, over the same rows the table is showing. */
export async function getCollectionSummary(sectionId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_student_balances", {
    p_section_id: sectionId || undefined,
    p_only_outstanding: false,
  });

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const charged = rows.reduce((s, r) => s + Number(r.charged) + Number(r.fines), 0);
  const collected = rows.reduce((s, r) => s + Number(r.paid) - Number(r.refunds), 0);
  const relieved = rows.reduce((s, r) => s + Number(r.discounts) + Number(r.write_offs), 0);
  const outstanding = rows.reduce((s, r) => s + Math.max(0, Number(r.balance)), 0);
  const inCredit = rows.reduce((s, r) => s + Math.max(0, -Number(r.balance)), 0);
  const defaulters = rows.filter((r) => Number(r.balance) > 0).length;

  return {
    students: rows.length,
    charged,
    collected,
    relieved,
    outstanding,
    inCredit,
    defaulters,
    // Of what was actually billable, how much has come in.
    collectionRate: charged - relieved > 0 ? Math.round((collected / (charged - relieved)) * 100) : null,
  };
}

export type LedgerEntryRow = {
  id: string;
  entryType: string;
  amount: number;
  occurredAt: string;
  receiptNumber: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  invoiceNumber: string | null;
  reversesEntryId: string | null;
  isReversed: boolean;
};

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  cancelReason: string | null;
  notes: string | null;
  total: number;
  lines: { id: string; description: string; amount: number }[];
};

export type StudentAccount = {
  student: {
    id: string;
    admissionNumber: string;
    fullName: string;
    sectionLabel: string | null;
    rollNumber: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
  } | null;
  invoices: InvoiceRow[];
  entries: LedgerEntryRow[];
  charged: number;
  balance: number;
};

/**
 * One student's whole fee account: the bills, every movement against them, and
 * the balance that reconciles the two.
 *
 * Deliberately three queries rather than one join -- a join across invoices,
 * lines and ledger entries multiplies rows and then has to be de-duplicated in
 * JavaScript, which is where balance bugs come from.
 */
export async function getStudentAccount(studentId: string): Promise<StudentAccount> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  // Session-scoped, per rule 2, and so that `balance` here agrees with the
  // balance `fees_student_balances()` reports on the collection screen --
  // which is also this session only. Last year's settled account is history,
  // not part of what this family owes now.
  let invoiceQuery = supabase
    .from("invoices")
    .select("id, invoice_number, issue_date, due_date, status, cancel_reason, notes, invoice_lines ( id, description, amount )")
    .eq("student_id", studentId)
    .order("issue_date", { ascending: false });

  let entryQuery = supabase
    .from("ledger_entries")
    .select("id, entry_type, amount, occurred_at, receipt_number, method, reference, note, reverses_entry_id, invoices ( invoice_number )")
    .eq("student_id", studentId)
    .order("occurred_at", { ascending: false });

  if (ctx?.currentSessionId) {
    invoiceQuery = invoiceQuery.eq("session_id", ctx.currentSessionId);
    entryQuery = entryQuery.eq("session_id", ctx.currentSessionId);
  }

  const [studentRes, invoiceRes, entryRes] = await Promise.all([
    supabase
      .from("students")
      .select(
        `id, admission_number,
         people:person_id ( first_name, last_name ),
         enrolments ( roll_number, sections ( name, class_levels ( name ) ) ),
         guardian_student ( is_primary, guardians ( people:person_id ( first_name, last_name, phone ) ) )`,
      )
      .eq("id", studentId)
      .maybeSingle(),
    invoiceQuery,
    entryQuery,
  ]);

  if (studentRes.error) throw new Error(studentRes.error.message);
  if (invoiceRes.error) throw new Error(invoiceRes.error.message);
  if (entryRes.error) throw new Error(entryRes.error.message);

  const s = studentRes.data;
  const person = s?.people;
  const enrolment = Array.isArray(s?.enrolments) ? s.enrolments[0] : s?.enrolments;
  const links = Array.isArray(s?.guardian_student) ? s.guardian_student : [];
  const primary = links.find((l) => l.is_primary) ?? links[0];
  const guardianPerson = primary?.guardians?.people;

  const invoices: InvoiceRow[] = (invoiceRes.data ?? []).map((i) => {
    const lines = (i.invoice_lines ?? []).map((l) => ({
      id: l.id,
      description: l.description,
      amount: Number(l.amount),
    }));
    return {
      id: i.id,
      invoiceNumber: i.invoice_number,
      issueDate: i.issue_date,
      dueDate: i.due_date,
      status: i.status,
      cancelReason: i.cancel_reason,
      notes: i.notes,
      total: lines.reduce((sum, l) => sum + l.amount, 0),
      lines,
    };
  });

  const raw = entryRes.data ?? [];
  // An entry that something else reverses is shown struck through rather than
  // hidden: the ledger is the record, and hiding a cancelled receipt is how a
  // book stops matching the receipts a parent is holding.
  const reversedIds = new Set(raw.map((e) => e.reverses_entry_id).filter(Boolean) as string[]);

  const entries: LedgerEntryRow[] = raw.map((e) => ({
    id: e.id,
    entryType: e.entry_type,
    amount: Number(e.amount),
    occurredAt: e.occurred_at,
    receiptNumber: e.receipt_number,
    method: e.method,
    reference: e.reference,
    note: e.note,
    invoiceNumber: e.invoices?.invoice_number ?? null,
    reversesEntryId: e.reverses_entry_id,
    isReversed: reversedIds.has(e.id),
  }));

  const charged = invoices
    .filter((i) => i.status === "issued")
    .reduce((sum, i) => sum + i.total, 0);
  const balance = charged + entries.reduce((sum, e) => sum + e.amount, 0);

  return {
    student: s
      ? {
          id: s.id,
          admissionNumber: s.admission_number,
          fullName: person ? `${person.first_name} ${person.last_name}` : "Unknown",
          sectionLabel:
            enrolment?.sections && enrolment.sections.class_levels
              ? `${enrolment.sections.class_levels.name} · ${enrolment.sections.name}`
              : null,
          rollNumber: enrolment?.roll_number ?? null,
          guardianName: guardianPerson
            ? `${guardianPerson.first_name} ${guardianPerson.last_name}`
            : null,
          guardianPhone: guardianPerson?.phone ?? null,
        }
      : null,
    invoices,
    entries,
    charged,
    balance,
  };
}

export async function listFeeHeads() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_heads")
    .select("id, code, name, description, category, is_active")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listFeeStructures() {
  const ctx = await getUserContext();
  const supabase = await createClient();

  let query = supabase
    .from("fee_structures")
    .select("id, amount, frequency, class_level_id, fee_head_id, class_levels ( name, sequence ), fee_heads ( name, code )");

  if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      frequency: r.frequency,
      classLevelId: r.class_level_id,
      feeHeadId: r.fee_head_id,
      classLevel: r.class_levels?.name ?? "—",
      sequence: r.class_levels?.sequence ?? 0,
      feeHead: r.fee_heads?.name ?? "—",
      feeHeadCode: r.fee_heads?.code ?? "",
    }))
    .sort((a, b) => a.sequence - b.sequence || a.feeHead.localeCompare(b.feeHead));
}

export async function listClassLevels() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_levels")
    .select("id, name, sequence")
    .order("sequence");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Postgres raises these as plain messages. They are written to be shown to an
 * accountant as-is, so the action passes them through rather than replacing
 * them with something vaguer.
 */
function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export async function recordPayment(input: unknown): Promise<ActionResult<{ receiptNumber: string | null }>> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_record_payment", {
    p_student_id: parsed.data.studentId,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
    p_occurred_at: new Date(parsed.data.occurredAt).toISOString(),
    p_reference: parsed.data.reference || undefined,
    p_invoice_id: parsed.data.invoiceId || undefined,
    p_note: parsed.data.note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/fees");
  revalidatePath(`/fees/students/${parsed.data.studentId}`);
  return { ok: true, data: { receiptNumber: data?.receipt_number ?? null } };
}

export async function recordRefund(input: unknown): Promise<ActionResult<{ receiptNumber: string | null }>> {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_record_refund", {
    p_student_id: parsed.data.studentId,
    p_amount: parsed.data.amount,
    p_method: parsed.data.method,
    p_occurred_at: new Date(parsed.data.occurredAt).toISOString(),
    p_reference: parsed.data.reference || undefined,
    p_note: parsed.data.note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath(`/fees/students/${parsed.data.studentId}`);
  return { ok: true, data: { receiptNumber: data?.receipt_number ?? null } };
}

export async function recordAdjustment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_record_adjustment", {
    p_student_id: parsed.data.studentId,
    p_entry_type: parsed.data.entryType,
    p_amount: parsed.data.amount,
    p_note: parsed.data.note,
    p_invoice_id: parsed.data.invoiceId || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/fees");
  revalidatePath(`/fees/students/${parsed.data.studentId}`);
  return { ok: true, data: { id: data!.id } };
}

/**
 * The only undo in this module. The pre-check inside the function gives the
 * friendly message; the unique index is what actually prevents a double
 * reversal, so a race surfaces as 23505 and is translated back here.
 */
export async function reverseEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = reversalSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_reverse_entry", {
    p_entry_id: parsed.data.entryId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.code === "23505") return fail("That entry has already been reversed.");
    return fail(error.message);
  }

  revalidatePath("/fees");
  return { ok: true, data: { id: data!.id } };
}

export async function generateInvoice(input: unknown): Promise<ActionResult<{ invoiceNumber: string }>> {
  const parsed = generateInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_generate_invoice", {
    p_student_id: parsed.data.studentId,
    p_due_date: parsed.data.dueDate,
    p_notes: parsed.data.notes || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/fees");
  revalidatePath(`/fees/students/${parsed.data.studentId}`);
  return { ok: true, data: { invoiceNumber: data!.invoice_number } };
}

export async function generateSectionInvoices(input: unknown): Promise<ActionResult<{ created: number }>> {
  const parsed = generateSectionInvoicesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_generate_section_invoices", {
    p_section_id: parsed.data.sectionId,
    p_due_date: parsed.data.dueDate,
  });

  if (error) return fail(error.message);

  revalidatePath("/fees");
  return { ok: true, data: { created: typeof data === "number" ? data : 0 } };
}

export async function cancelInvoice(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = cancelInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fees_cancel_invoice", {
    p_invoice_id: parsed.data.invoiceId,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error.message);

  revalidatePath("/fees");
  return { ok: true, data: { id: data!.id } };
}

export async function saveFeeHead(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = feeHeadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    code: parsed.data.code.toUpperCase(),
    name: parsed.data.name,
    description: parsed.data.description || null,
    category: parsed.data.category,
    is_active: parsed.data.isActive,
  };

  const { data, error } = id
    ? await supabase.from("fee_heads").update(payload).eq("id", id).select("id").single()
    : await supabase.from("fee_heads").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That code is already used by another fee head.",
        fieldErrors: { code: ["Already in use"] },
      };
    }
    return fail(error.message);
  }

  revalidatePath("/fees/setup");
  return { ok: true, data: { id: data.id } };
}

/**
 * Upserted on (tenant, session, class level, fee head): setting an amount that
 * is already set is an edit, not a duplicate row.
 */
export async function saveFeeStructure(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = feeStructureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no active academic session.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_structures")
    .upsert(
      {
        tenant_id: ctx.tenantId,
        session_id: ctx.currentSessionId,
        class_level_id: parsed.data.classLevelId,
        fee_head_id: parsed.data.feeHeadId,
        amount: parsed.data.amount,
        frequency: parsed.data.frequency,
      },
      { onConflict: "tenant_id,session_id,class_level_id,fee_head_id" },
    )
    .select("id")
    .single();

  if (error) return fail(error.message);

  revalidatePath("/fees/setup");
  return { ok: true, data: { id: data.id } };
}

export async function deleteFeeStructure(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("fee_structures").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/fees/setup");
  return { ok: true, data: undefined };
}
