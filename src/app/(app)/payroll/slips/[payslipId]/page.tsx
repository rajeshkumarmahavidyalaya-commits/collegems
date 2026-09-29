import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPayslipDocument } from "../../actions";
import { PrintButton } from "../../../certificates/[id]/print-button";
import { paymentMethodLabel } from "@/lib/validations/hr";
import { formatCurrency, formatDate, formatMonth } from "@/lib/i18n/format";
import { getLocale, getT } from "@/lib/i18n/server";

export const metadata = { title: "Salary slip" };

/**
 * One salary slip, laid out as the paper (0300). A Server Component: the only
 * client code is the print button, so the page pays nothing for the i18n
 * catalogue (rule 15's server-side bargain).
 *
 * RLS decides who reaches it -- the payroll office any slip, a member of staff
 * their own finalised ones -- so "not found" covers a missing slip and one that
 * is somebody else's alike.
 */
export default async function PayslipPage({ params }: { params: Promise<{ payslipId: string }> }) {
  const { payslipId } = await params;
  const [doc, t, locale] = await Promise.all([getPayslipDocument(payslipId), getT(), getLocale()]);
  if (!doc) notFound();

  const money = (n: number) => formatCurrency(n, locale);
  const outstanding = doc.net - doc.paid;
  const address = [
    doc.school.addressLine1,
    doc.school.addressLine2,
    [doc.school.city, doc.school.state].filter(Boolean).join(", "),
    doc.school.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-4">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/payroll">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            Payroll
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`/payroll/slips/${doc.id}/pdf`} download>
              <Download className="size-4" aria-hidden="true" />
              PDF
            </a>
          </Button>
          <PrintButton />
        </div>
      </div>

      <article
        data-print="sheet"
        aria-label={`${t("pdf.payslip.heading")} ${formatMonth(doc.periodMonth, locale)}`}
        className="mx-auto w-full max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-8"
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{doc.school.name}</h1>
            {address && <p className="mt-1 text-sm text-muted-foreground">{address}</p>}
          </div>
          <div className="text-end">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("pdf.payslip.heading")}
            </p>
            <p className="text-lg font-semibold">{formatMonth(doc.periodMonth, locale)}</p>
            {doc.draft && <Badge variant="warning">{t("pdf.payslip.draft")}</Badge>}
          </div>
        </header>

        <section className="border-b border-border py-5">
          <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
            {t("pdf.payslip.employee")}
          </h2>
          <p className="mt-1 font-medium">
            <bdi>{doc.staff.name}</bdi>
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{doc.staff.employeeCode}</span> · {doc.staff.designation}
            {doc.staff.department ? ` · ${doc.staff.department}` : ""}
          </p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("pdf.payslip.workingDays")}</dt>
            <dd className="text-end tabular-nums">{doc.days.working}</dd>
            <dt className="text-muted-foreground">{t("pdf.payslip.paidDays")}</dt>
            <dd className="text-end tabular-nums">{doc.days.paid}</dd>
            {doc.days.lop > 0 && (
              <>
                <dt className="text-muted-foreground">{t("pdf.payslip.lopDays")}</dt>
                <dd className="text-end tabular-nums">{doc.days.lop}</dd>
              </>
            )}
          </dl>
        </section>

        <div className="grid gap-6 py-5 sm:grid-cols-2">
          <section>
            <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("pdf.payslip.earnings")}
            </h2>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {doc.earnings.map((l, i) => (
                <div key={`e${i}`} className="contents">
                  <dt>{l.name}</dt>
                  <dd className="text-end font-mono tabular-nums">{money(l.amount)}</dd>
                </div>
              ))}
              <dt className="border-t border-border pt-1 font-medium">{t("pdf.payslip.gross")}</dt>
              <dd className="border-t border-border pt-1 text-end font-mono font-medium tabular-nums">
                {money(doc.gross)}
              </dd>
            </dl>
          </section>
          <section>
            <h2 className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("pdf.payslip.deductions")}
            </h2>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {doc.deductions.map((l, i) => (
                <div key={`d${i}`} className="contents">
                  <dt>{l.name}</dt>
                  <dd className="text-end font-mono tabular-nums">{money(l.amount)}</dd>
                </div>
              ))}
              <dt className="border-t border-border pt-1 font-medium">
                {t("pdf.payslip.totalDeductions")}
              </dt>
              <dd className="border-t border-border pt-1 text-end font-mono font-medium tabular-nums">
                {money(doc.totalDeductions)}
              </dd>
            </dl>
          </section>
        </div>

        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4">
          <span className="font-medium">{t("pdf.payslip.net")}</span>
          <span className="font-mono text-2xl font-semibold tabular-nums">{money(doc.net)}</span>
        </div>

        {!doc.draft && (
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <dt>{t("pdf.payslip.paid")}</dt>
            <dd className="text-end font-mono tabular-nums">{money(doc.paid)}</dd>
            {outstanding > 0.004 && (
              <>
                <dt>{t("pdf.payslip.outstanding")}</dt>
                <dd className="text-end font-mono tabular-nums">{money(outstanding)}</dd>
              </>
            )}
            {doc.lastPaidOn && (
              <>
                <dt>{t("pdf.payslip.paidOn")}</dt>
                <dd className="text-end">
                  {formatDate(doc.lastPaidOn, locale)}
                  {doc.lastMethod ? ` · ${paymentMethodLabel(doc.lastMethod, t)}` : ""}
                </dd>
              </>
            )}
          </dl>
        )}

        {doc.note?.trim() && (
          <p className="mt-6 text-sm whitespace-pre-line text-muted-foreground">{doc.note}</p>
        )}
      </article>
    </div>
  );
}
