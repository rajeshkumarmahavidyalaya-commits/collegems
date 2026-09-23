import { notFound } from "next/navigation";
import { getReceiptDocument } from "../../actions";
import { ReceiptSheet } from "./receipt-sheet";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const [{ entryId }, { print }] = await Promise.all([params, searchParams]);
  const doc = await getReceiptDocument(entryId);

  // RLS decides visibility, so "not found" covers a missing receipt and one
  // belonging to another family or school alike.
  if (!doc) notFound();

  return <ReceiptSheet doc={doc} autoPrint={print === "1"} />;
}
