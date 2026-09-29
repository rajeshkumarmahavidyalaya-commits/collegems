import { getPayslipDocument } from "../../../actions";
import { paymentMethodLabel } from "@/lib/validations/hr";
import { getLocale, getT } from "@/lib/i18n/server";
import { payslipFileName, renderPayslip } from "@/lib/pdf/payslip";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A salary slip, as a file (0300). The receipt route's reasoning applies
 * unchanged: RLS is the only gate -- an administrator or accountant reads any
 * slip, a member of staff their own finalised ones -- and the 404 claims
 * nothing, because "no such slip" and "not your slip" are the same answer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ payslipId: string }> },
) {
  const { payslipId } = await params;
  const doc = await getPayslipDocument(payslipId);
  if (!doc) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const [t, locale] = await Promise.all([getT(), getLocale()]);

  try {
    const bytes = await renderPayslip(doc, locale, {
      heading: t("pdf.payslip.heading"),
      draft: t("pdf.payslip.draft"),
      employee: t("pdf.payslip.employee"),
      workingDays: t("pdf.payslip.workingDays"),
      paidDays: t("pdf.payslip.paidDays"),
      lopDays: t("pdf.payslip.lopDays"),
      earnings: t("pdf.payslip.earnings"),
      deductions: t("pdf.payslip.deductions"),
      gross: t("pdf.payslip.gross"),
      totalDeductions: t("pdf.payslip.totalDeductions"),
      net: t("pdf.payslip.net"),
      paid: t("pdf.payslip.paid"),
      outstanding: t("pdf.payslip.outstanding"),
      paidOn: t("pdf.payslip.paidOn"),
      method: (code) => (code ? paymentMethodLabel(code, t) : "—"),
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${payslipFileName(doc.staff.employeeCode, doc.periodMonth)}"`,
        // The slip is frozen once its run is final; what has been paid is not.
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
