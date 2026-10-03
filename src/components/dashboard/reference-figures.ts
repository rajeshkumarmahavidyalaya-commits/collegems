import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";

/**
 * The reference dashboard's figures that `dashboard_summary()` does not carry:
 * active inquiries, classes, income, expenses, books, pending leave of both
 * kinds, and its two lists (the last ten active inquiries, the last fifteen
 * admissions this year).
 *
 * Every read runs as the signed-in person, so RLS decides what is counted, and
 * each figure is gated on the permission of whoever *acts* on it (rule 4's
 * reports section): a family holds `students.view` and `fees.view` and would
 * otherwise be told about "the school's" admissions and invoices while seeing
 * only their own. A figure the caller may not have is `null`, never 0, so the
 * page can say what it withheld (rule 11).
 */

export type InquiryRow = {
  id: string;
  name: string;
  className: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  receivedOn: string;
  followUpOn: string | null;
};

export type AdmissionRow = {
  id: string;
  name: string;
  className: string | null;
  sectionName: string | null;
  admissionNumber: string;
  admissionDate: string | null;
};

export type ReferenceFigures = {
  activeInquiries: number | null;
  classes: number | null;
  income: number | null;
  expenses: number | null;
  books: number | null;
  pendingStudentLeave: number | null;
  pendingStaffLeave: number | null;
  inquiries: InquiryRow[] | null;
  admissions: AdmissionRow[] | null;
};

/** The statuses an enquiry is still open in; `admitted` and `lost` are closed. */
export const ACTIVE_ENQUIRY_STATUSES = ["new", "contacted", "visited", "applied"] as const;

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function getReferenceFigures(sessionId: string | null): Promise<ReferenceFigures> {
  const supabase = await createClient();
  const [canInquiries, canClasses, canAccounts, canBooks, canStudentLeave, canStaffLeave, canStudents] =
    await Promise.all([
      hasPermission("frontoffice.view"),
      hasPermission("academics.view"),
      hasPermission("accounts.view"),
      hasPermission("library.view"),
      hasPermission("leave.decide"),
      hasPermission("hr.manage"),
      hasPermission("students.manage"),
    ]);

  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await q;
    return error ? null : (n ?? 0);
  };

  const [activeInquiries, inquiries, classes, accounts, books, pendingStudentLeave, pendingStaffLeave, admissions] =
    await Promise.all([
      canInquiries
        ? count(
            supabase
              .from("enquiries")
              .select("id", { count: "exact", head: true })
              .in("status", [...ACTIVE_ENQUIRY_STATUSES]),
          )
        : null,
      canInquiries
        ? supabase
            .from("enquiries")
            .select(
              "id, applicant_first_name, applicant_last_name, contact_phone, contact_email, notes, created_at, next_follow_up_on, class_levels(name)",
            )
            .in("status", [...ACTIVE_ENQUIRY_STATUSES])
            .order("created_at", { ascending: false })
            .order("id")
            .limit(10)
            .then(({ data, error }) =>
              error
                ? null
                : (data ?? []).map(
                    (r): InquiryRow => ({
                      id: r.id,
                      name: [r.applicant_first_name, r.applicant_last_name].filter(Boolean).join(" "),
                      className: one(r.class_levels as One<{ name: string }>)?.name ?? null,
                      phone: r.contact_phone,
                      email: r.contact_email,
                      note: r.notes,
                      receivedOn: r.created_at,
                      followUpOn: r.next_follow_up_on,
                    }),
                  ),
            )
        : null,
      canClasses ? count(supabase.from("class_levels").select("id", { count: "exact", head: true })) : null,
      // The accounts module's own income and expenditure statement, through the
      // same gate the Reports screen uses; its total rows carry no account code.
      canAccounts
        ? supabase
            .rpc("report_run", { p_key: "accounts.income_expenditure", p_params: {}, p_limit: 1000, p_offset: 0 })
            .then(({ data, error }) => {
              if (error) return null;
              const rows = (data ?? []).map((r) => (r.row_data ?? {}) as Record<string, unknown>);
              const total = (section: string) => {
                const row = rows.find((r) => r.section === section && !r.code);
                return row ? Number(row.amount ?? 0) : 0;
              };
              return { income: total("Income"), expenses: total("Expenditure") };
            })
        : null,
      canBooks ? count(supabase.from("books").select("id", { count: "exact", head: true })) : null,
      canStudentLeave
        ? count(
            supabase.from("student_leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
          )
        : null,
      canStaffLeave
        ? count(supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"))
        : null,
      canStudents && sessionId
        ? supabase
            .from("students")
            .select(
              "id, admission_number, admission_date, people(first_name, last_name), enrolments!inner(session_id, sections(name, class_levels(name)))",
            )
            .eq("enrolments.session_id", sessionId)
            .order("admission_date", { ascending: false, nullsFirst: false })
            .order("admission_number", { ascending: false })
            .limit(15)
            .then(({ data, error }) =>
              error
                ? null
                : (data ?? []).map((r): AdmissionRow => {
                    const p = one(r.people as One<{ first_name: string; last_name: string | null }>);
                    const e = one(
                      r.enrolments as One<{ sections: One<{ name: string; class_levels: One<{ name: string }> }> }>,
                    );
                    const sec = e ? one(e.sections) : null;
                    return {
                      id: r.id,
                      name: p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "",
                      className: sec ? (one(sec.class_levels)?.name ?? null) : null,
                      sectionName: sec?.name ?? null,
                      admissionNumber: r.admission_number,
                      admissionDate: r.admission_date,
                    };
                  }),
            )
        : null,
    ]);

  return {
    activeInquiries,
    classes,
    income: accounts?.income ?? null,
    expenses: accounts?.expenses ?? null,
    books,
    pendingStudentLeave,
    pendingStaffLeave,
    inquiries,
    admissions,
  };
}
