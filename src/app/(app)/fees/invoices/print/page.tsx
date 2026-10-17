import { Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { listSections } from "../../../students/actions";
import { getInvoiceDocuments } from "../../actions";
import { InvoiceSheet } from "../[invoiceId]/invoice-sheet";
import { PrintControls } from "./print-controls";
import { PRINT_STATUSES, type PrintStatus } from "./print-status";
import { ON_ROLL } from "@/lib/enrolment";

export const metadata = { title: "Print Invoices" };

/** More than this is a print run nobody checks; the page says how many and asks for a narrower one. */
const MAX = 200;

/**
 * The reference's Print Invoices in Bulk: this year's bills for a class and a
 * status, one per sheet of paper. The bills are the same documents the single
 * invoice page prints (getInvoiceDocuments), in class and roll order.
 */
export default async function PrintInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; status?: string }>;
}) {
  const params = await searchParams;
  const status: PrintStatus = (PRINT_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as PrintStatus)
    : "unpaid";
  const sectionId = params.section && /^[0-9a-f-]{36}$/i.test(params.section) ? params.section : "";

  const [ctx, canCollect, sections] = await Promise.all([getUserContext(), hasPermission("fees.collect"), listSections()]);
  const controls = (
    <PrintControls sections={sections.map((s) => ({ id: s.id, label: s.label }))} sectionId={sectionId} status={status} />
  );

  if (!canCollect) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Print Invoices" icon={Printer} />
        <Message>Printing a class&apos;s bills is for the people who take fees. Your role does not.</Message>
      </div>
    );
  }
  if (!sectionId) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Print Invoices" icon={Printer} />
        {controls}
        <Message>Choose a class to print its invoices for {ctx?.currentSessionName ?? "this year"}.</Message>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: enrolled } = await supabase
    .from("enrolments")
    .select("student_id")
    .eq("section_id", sectionId)
    .eq("session_id", ctx?.currentSessionId ?? "")
    .in("status", ON_ROLL);
  const studentIds = [...new Set((enrolled ?? []).map((e) => e.student_id))];

  let ids: string[] = [];
  let count = 0;
  if (studentIds.length) {
    let q = supabase
      .from("invoices")
      .select("id", { count: "exact" })
      .eq("session_id", ctx?.currentSessionId ?? "")
      .in("student_id", studentIds);
    q = status === "cancelled" ? q.eq("status", "cancelled") : status === "all" ? q : q.eq("status", "issued");
    const { data, count: c, error } = await q.order("invoice_number").limit(MAX + 1);
    if (error) throw new Error(error.message);
    ids = (data ?? []).map((r) => r.id);
    count = c ?? ids.length;
  }

  if (count > MAX) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Print Invoices" icon={Printer} />
        {controls}
        <Message>
          {count} invoices match, more than the {MAX} this page prints at once. Choose a narrower status, such as
          unpaid.
        </Message>
      </div>
    );
  }

  const docs = (await getInvoiceDocuments(ids))
    .filter((d) => (status === "unpaid" ? d.outstanding > 0 : status === "paid" ? d.outstanding <= 0 : true))
    .sort(
      (a, b) =>
        (a.student?.sectionLabel ?? "").localeCompare(b.student?.sectionLabel ?? "") ||
        (Number(a.student?.rollNumber) || 0) - (Number(b.student?.rollNumber) || 0) ||
        (a.student?.fullName ?? "").localeCompare(b.student?.fullName ?? "") ||
        a.invoice.number.localeCompare(b.invoice.number),
    );

  return (
    <div className="flex flex-col gap-4">
      <div data-print="hide" className="flex flex-col gap-4">
        <PageToolbar title="Print Invoices" icon={Printer} />
        {controls}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {docs.length === 0
            ? "No invoices match."
            : `${docs.length} ${docs.length === 1 ? "invoice" : "invoices"}, one to a page.`}
        </p>
      </div>
      {docs.map((doc) => (
        <div key={doc.invoice.id} data-print="page">
          <InvoiceSheet doc={doc} bare />
        </div>
      ))}
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}
