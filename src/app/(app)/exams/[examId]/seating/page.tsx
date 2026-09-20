import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getExam } from "../../actions";
import { listSittings } from "../../seating-actions";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { PLAN_STATUS_LABEL, planStatusTone, sittingState, type PlanStatus } from "@/lib/validations/seating-display";
import { GenerateSitting } from "./generate-sitting";

export const metadata = { title: "Seating" };

/**
 * The sittings of one exam.
 *
 * A Server Component, and the whole page except one button is. Rule 15's
 * bargain: a `Translator` reached through `await getT()` costs the browser
 * nothing, and the only thing here that needs state is the generate button.
 *
 * The list is built from the papers rather than from the plans, so a date with
 * no plan is a row. A list driven off `exam_seat_plans` would be empty on the
 * day the work starts, which is the only day anybody opens this.
 */
export default async function SeatingPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const [exam, locale] = await Promise.all([getExam(examId), getLocale()]);
  if (!exam) notFound();

  const [sittings, canManage] = await Promise.all([
    listSittings(examId),
    hasPermission("exams.manage"),
  ]);

  const undated = exam.paperCount - sittings.reduce((n, s) => n + s.papers, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/exams/${examId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          {exam.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Seating</h1>
        <p className="text-sm text-muted-foreground">
          One plan per sitting. Candidates writing the same paper are kept off adjacent seats, which
          is the whole reason a plan exists — seat a class in its own room and every neighbour has
          the same question paper in front of them.
        </p>
      </div>

      {undated > 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {undated} paper{undated === 1 ? " has" : "s have"} no date, so {undated === 1 ? "it is" : "they are"}{" "}
            not part of any sitting and {undated === 1 ? "cannot be" : "cannot be"} seated. Set the dates on{" "}
            <Link href={`/exams/${examId}`} className="underline underline-offset-4">
              the exam
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {sittings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No sitting has a date yet</CardTitle>
            <CardDescription>
              A seating plan is made for a date. Give the papers their dates and each one becomes a
              sitting here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {sittings.map((sitting) => {
            const state = sittingState(sitting.planStatus);
            return (
              <Card key={sitting.sitsOn}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
                      {formatDate(sitting.sitsOn, locale)}
                      {sitting.planStatus && (
                        <Badge variant={planStatusTone(sitting.planStatus)}>
                          {PLAN_STATUS_LABEL[sitting.planStatus as PlanStatus] ?? sitting.planStatus}
                        </Badge>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      <Users className="size-3.5" aria-hidden="true" />
                      {sitting.candidates} candidate{sitting.candidates === 1 ? "" : "s"} ·{" "}
                      {sitting.papers} paper{sitting.papers === 1 ? "" : "s"}
                      {state === "none" ? "" : ` · ${sitting.seats} seated`}
                      {sitting.optionalPapers > 0 &&
                        ` · ${sitting.optionalPapers} optional, so the whole section is counted`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {sitting.planId ? (
                      <Button asChild variant="outline">
                        <Link href={`/exams/${examId}/seating/${sitting.planId}`}>
                          {state === "published" ? "Open the plan" : "Review the draft"}
                        </Link>
                      </Button>
                    ) : (
                      canManage && (
                        <GenerateSitting
                          examId={examId}
                          sitsOn={sitting.sitsOn}
                          candidates={sitting.candidates}
                        />
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
