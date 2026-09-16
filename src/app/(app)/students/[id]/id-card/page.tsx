import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT, getLocale } from "@/lib/i18n/server";
import { hasPermission } from "@/lib/auth/permissions";
import { getIdCard } from "../../id-cards/actions";
import { IdCardFace } from "@/components/id-card/id-card-sheet";
import { PrintCardsButton } from "@/components/id-card/print-cards-button";
import { cardGaps, isPrintable, studentFace } from "@/lib/validations/id-card";
import { formatDate } from "@/lib/i18n/format";

export const metadata = { title: "ID card" };

/**
 * One child's card, reached from their own page.
 *
 * `notFound()` when the read comes back empty, which is now a designed 404
 * inside the shell — and its copy is deliberately silent about *why*, because
 * "no such student" and "not a student you may see" are the same answer under
 * RLS.
 */
export default async function StudentIdCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [canView, result, t, locale] = await Promise.all([
    hasPermission("students.view"),
    getIdCard(id),
    getT(),
    getLocale(),
  ]);

  if (!canView || !result) notFound();

  const gaps = cardGaps(result.card, t);
  const printable = isPrintable(gaps);

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href={`/students/${id}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {result.card.fullName}
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {/* Offered only when the card can actually be produced. `blocking`
              has said "no photograph, no identity card" since this module
              shipped and decided nothing but a text colour; `isPrintable` is
              that sentence made executable, and the route refuses on the same
              predicate. A control that will refuse you is worse than no
              control, because it costs the person the work of trying.

              Printing is *not* gated: that is the school's own paper in the
              school's own tray, and a half-finished card can be looked at. A
              file is what leaves the building. */}
          {printable && (
            <Button asChild variant="outline">
              <a href={`/students/${id}/id-card/pdf`} download>
                <Download className="size-4" aria-hidden="true" />
                Download PDF
              </a>
            </Button>
          )}
          <PrintCardsButton count={1} />
        </div>
      </div>

      {gaps.length > 0 && (
        <ul data-print="hide" className="flex flex-col gap-1 text-sm text-muted-foreground">
          {gaps.map((gap) => (
            <li key={gap.field} className={gap.blocking ? "text-destructive" : undefined}>
              {gap.message}
            </li>
          ))}
        </ul>
      )}

      {/* Bounded width so a single card prints at its real size rather than
          stretched across an A4 sheet. */}
      <div className="max-w-md">
        <IdCardFace
          card={studentFace(result.card, t, formatDate, locale)}
          school={result.school}
          t={t}
        />
      </div>
    </div>
  );
}
