import { getInvoiceDocument } from "../../../actions";
import { methodLabel } from "@/lib/validations/fees-display";
import { getLocale, getT } from "@/lib/i18n/server";
import { invoiceFileName, renderInvoice } from "@/lib/pdf/invoice";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A fee bill, as a file.
 *
 * The certificate route's reasoning applies unchanged — bytes rather than a
 * React value, RLS rather than a second permission check, and a 404 that
 * claims nothing, because *"no such invoice"* and *"not your invoice"* are the
 * same answer under a row-scoped policy.
 *
 * ## The locale is the reader's, and that is a decision
 *
 * Rule 15: the locale is a property of a person. So the file is produced in the
 * language of whoever asked for it, exactly as the screen is, and the money and
 * dates go through `src/lib/i18n/format.ts` rather than a hardcoded `en-IN`.
 *
 * The alternative — the *school's* `default_locale`, on the grounds that a bill
 * is the school's document and the bursar downloading it may not be its reader
 * — is a real argument and is **not** what this does. It would mean a family
 * and the office holding two differently-worded copies of one bill, and the
 * school has no way to say which is authoritative. Named here rather than left
 * as an accident, because it is the kind of thing somebody will want to change
 * and should change deliberately.
 *
 * A consequence, and it is honest rather than hidden: a Hindi or Urdu reader
 * gets the 422 below, because `formatDate` returns Devanagari month names and
 * the document font is Latin-only. The message says so and points at printing,
 * which uses the reader's own system fonts and works.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params;
  const doc = await getInvoiceDocument(invoiceId);
  if (!doc) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const [t, locale] = await Promise.all([getT(), getLocale()]);

  try {
    const bytes = await renderInvoice(doc, locale, {
      method: (code) => (code ? methodLabel(code, t) : ""),
      heading: t("pdf.invoice.heading"),
      billedTo: t("pdf.invoice.billedTo"),
      charges: t("pdf.invoice.charges"),
      payments: t("pdf.invoice.payments"),
      total: t("pdf.invoice.total"),
      paid: t("pdf.invoice.paid"),
      outstanding: t("pdf.invoice.outstanding"),
      noPayments: t("pdf.invoice.noPayments"),
      cancelled: t("pdf.invoice.cancelled"),
      producedOn: t("pdf.invoice.producedOn"),
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${invoiceFileName(doc.invoice.number)}"`,
        // `no-store`, not merely `private`: unlike a certificate, a bill is an
        // account and moves the moment a payment is taken. A cached copy is a
        // family shown a balance the counter has already changed.
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
