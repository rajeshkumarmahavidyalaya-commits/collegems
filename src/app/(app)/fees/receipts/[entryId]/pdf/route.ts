import { getReceiptDocument } from "../../../actions";
import { methodLabel } from "@/lib/validations/fees-display";
import { getLocale, getT } from "@/lib/i18n/server";
import { receiptFileName, renderReceipt } from "@/lib/pdf/receipt";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A fee receipt, as a file. The invoice route's reasoning applies unchanged:
 * RLS is the only gate, and the 404 claims nothing, because *"no such receipt"*
 * and *"not your receipt"* are the same answer under a row-scoped policy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const { entryId } = await params;
  const doc = await getReceiptDocument(entryId);
  if (!doc) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const refund = doc.receipt.kind === "refund";

  try {
    const bytes = await renderReceipt(doc, locale, {
      method: (code) => (code ? methodLabel(code, t) : "—"),
      heading: t(refund ? "pdf.refund.heading" : "pdf.receipt.heading"),
      party: t(refund ? "pdf.refund.paidTo" : "pdf.receipt.receivedFrom"),
      amount: t(refund ? "pdf.refund.amount" : "pdf.receipt.amount"),
      paidBy: t("pdf.receipt.method"),
      reference: t("pdf.receipt.reference"),
      againstInvoice: t("pdf.receipt.againstInvoice"),
      onAccount: t("pdf.receipt.onAccount"),
      reversed: t("pdf.receipt.reversed"),
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${receiptFileName(doc.receipt.number)}"`,
        // The receipt itself never changes, but whether it was reversed can.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnrenderableDocument) {
      return new Response(error.message, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}
