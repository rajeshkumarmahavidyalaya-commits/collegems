import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { getStaffCard } from "../../id-cards/actions";
import { IdCardFace } from "@/components/id-card/id-card-sheet";
import { PrintCardsButton } from "@/components/id-card/print-cards-button";
import { staffCardGaps, staffFace } from "@/lib/validations/id-card";

export const metadata = { title: "Staff ID card" };

/**
 * One member of staff's card.
 *
 * `getStaffCard` returns null both when the row is not there and when the
 * caller lacks `staff.view`, and this renders the same designed 404 for both —
 * which is the right answer for the same reason the student one is: a message
 * that distinguished them would say which employee numbers are real.
 */
export default async function StaffIdCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, t] = await Promise.all([getStaffCard(id), getT()]);

  if (!result) notFound();

  const gaps = staffCardGaps(result.card, t);

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <Link href={`/staff/${id}`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {result.card.fullName}
          </Link>
        </Button>
        <PrintCardsButton count={1} />
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

      <div className="max-w-md">
        <IdCardFace card={staffFace(result.card, t)} school={result.school} t={t} />
      </div>
    </div>
  );
}
