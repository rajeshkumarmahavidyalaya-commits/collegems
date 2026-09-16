import Link from "next/link";
import { ArrowLeft, Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";
import { getStaffCards } from "./actions";
import { IdCardSheet } from "@/components/id-card/id-card-sheet";
import { PrintCardsButton } from "@/components/id-card/print-cards-button";
import { DepartmentPicker } from "./department-picker";
import {
  CARDS_PER_SHEET,
  MAX_CARDS_PER_RUN,
  isPrintable,
  setSummary,
  staffCardGaps,
  staffFace,
} from "@/lib/validations/id-card";

export const metadata = { title: "Staff ID cards" };

/**
 * Cards for everybody employed here.
 *
 * The gate lives in `getStaffCards`, not on this page, and that is deliberate:
 * RLS on `staff` is role-wide, so the rows come back to a librarian exactly as
 * they come back to the principal, and a check drawn only in the interface
 * would be rule 4's *"the UI layer is never the gate"* in its plainest form.
 * The page renders what the function chose to say.
 */
export default async function StaffIdCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const { department } = await searchParams;
  const [result, t] = await Promise.all([getStaffCards(department), getT()]);

  if (!result.ok && result.reason === "withheld") {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          {t("idCard.staffWithheld")}
        </CardContent>
      </Card>
    );
  }

  const cards = result.ok ? result.cards : [];
  const summary = setSummary(cards, t);
  const flagged = cards
    .map((card) => ({ card, gaps: staffCardGaps(card, t) }))
    .filter(({ gaps }) => gaps.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t("idCard.staffTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("idCard.staffSubtitle")}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/staff">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("nav.staff")}
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {result.ok && (
            <DepartmentPicker
              departments={result.departments}
              value={department ?? null}
              label={t("idCard.department")}
              allLabel={t("idCard.allDepartments")}
            />
          )}
          {/* See the student sheet: offered only when every card in the set can
              be produced, because a set is all-or-nothing. */}
          {cards.length > 0 && cards.every((card) => isPrintable(staffCardGaps(card, t))) && (
            <Button asChild variant="outline">
              <a
                href={`/staff/id-cards/pdf${department ? `?department=${encodeURIComponent(department)}` : ""}`}
                download
              >
                <Download className="size-4" aria-hidden="true" />
                {t("idCard.downloadPdf")}
              </a>
            </Button>
          )}
          <PrintCardsButton count={cards.length} />
        </div>

        {!result.ok && result.reason === "too-many" && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("idCard.tooMany", { count: result.count, max: MAX_CARDS_PER_RUN })}
          </p>
        )}

        {summary && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            {summary}
          </p>
        )}

        {flagged.length > 0 && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {flagged.length} / {cards.length}
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {flagged.map(({ card, gaps }) => (
                <li key={card.staffId} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/staff/${card.staffId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {card.fullName}
                  </Link>
                  <span className="text-muted-foreground">
                    {gaps.map((g) => g.message).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {result.ok && cards.length === 0 && (
        <Card data-print="hide">
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            {t("idCard.emptyStaff")}
          </CardContent>
        </Card>
      )}

      {cards.length > 0 && result.ok && (
        <IdCardSheet
          cards={cards.map((card) => staffFace(card, t))}
          school={result.school}
          t={t}
          perSheet={CARDS_PER_SHEET}
        />
      )}
    </div>
  );
}
