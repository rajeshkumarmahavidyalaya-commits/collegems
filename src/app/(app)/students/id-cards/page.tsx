import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { getT, getLocale } from "@/lib/i18n/server";
import { listSections } from "../actions";
import { getIdCards } from "./actions";
import { IdCardSheet } from "@/components/id-card/id-card-sheet";
import { PrintCardsButton } from "@/components/id-card/print-cards-button";
import { ClassPicker } from "./class-picker";
import { CARDS_PER_SHEET, MAX_CARDS_PER_RUN, cardGaps, setSummary } from "@/lib/validations/id-card";

export const metadata = { title: "ID cards" };

/**
 * Cards for a whole class, eight to a sheet.
 *
 * Gated on `students.view` rather than `students.manage`: a card carries the
 * name, class, admission number and guardian phone that `/students` already
 * shows the same roles, and RLS decides *which* children — a class teacher
 * printing "their" class gets their own, which is the right answer and needs no
 * second gate to produce it.
 *
 * The class list comes from `listSections()`, which is session-scoped, so the
 * picker cannot offer last year's "Grade 1 · A" beside this year's.
 */
export default async function IdCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  const [canView, sections, t, locale] = await Promise.all([
    hasPermission("students.view"),
    listSections(),
    getT(),
    getLocale(),
  ]);

  if (!canView) {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          {t("state.error.title")}
        </CardContent>
      </Card>
    );
  }

  const sectionId = section ?? sections[0]?.id ?? null;
  const result = sectionId ? await getIdCards(sectionId) : null;
  const cards = result?.ok ? result.cards : [];

  // One sentence for the set rather than eighty for forty cards, and the gap
  // list only for the cards that have one. A person about to press print wants
  // "six have no photograph", not six hundred words.
  const summary = result?.ok ? setSummary(cards, t) : null;
  const flagged = cards
    .map((card) => ({ card, gaps: cardGaps(card, t) }))
    .filter(({ gaps }) => gaps.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t("idCard.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("idCard.subtitle")}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/students">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("nav.students")}
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <ClassPicker sections={sections} value={sectionId} label={t("idCard.pickClass")} />
          <PrintCardsButton count={cards.length} />
        </div>

        {result && !result.ok && (
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
                <li key={card.studentId} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/students/${card.studentId}`}
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

      {result?.ok && cards.length === 0 && (
        <Card data-print="hide">
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            {t("idCard.emptyClass")}
          </CardContent>
        </Card>
      )}

      {cards.length > 0 && result?.ok && (
        <IdCardSheet
          cards={cards}
          school={result.school}
          t={t}
          locale={locale}
          perSheet={CARDS_PER_SHEET}
        />
      )}
    </div>
  );
}
