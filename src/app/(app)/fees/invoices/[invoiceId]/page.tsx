import { notFound } from "next/navigation";
import { getInvoiceDocument } from "../../actions";
import { InvoiceSheet } from "./invoice-sheet";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const doc = await getInvoiceDocument(invoiceId);

  // RLS already decides visibility, so "not found" covers both a missing
  // invoice and one belonging to another school.
  if (!doc) notFound();

  return <InvoiceSheet doc={doc} />;
}
