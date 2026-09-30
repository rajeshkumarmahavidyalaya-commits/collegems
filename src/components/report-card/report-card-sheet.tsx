import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPercent, resultLabel } from "@/lib/validations/exams";
import { formatDate } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import {
  attendancePercent,
  attendanceSentence,
  paperMark,
  paperNote,
  rankSentence,
  type ReportCard,
} from "@/lib/validations/report-cards";

/**
 * One card, on screen and on paper. A Server Component: nothing here is
 * interactive, and a document that a parent may be reading on a phone in a
 * corridor should not wait for JavaScript.
 *
 * The same markup prints. `data-print="page"` puts one child on one sheet;
 * `data-print="sheet"` strips the card chrome so a school's toner is not spent
 * on a rounded border.
 */
/**
 * The locale arrives as a prop rather than from `useI18n()`: this renders
 * inside two Server Components, where there is no provider. It defaults so a
 * caller that forgets still prints a readable date rather than throwing on a
 * document somebody is about to hand to a family.
 */
export function ReportCardSheet({
  card,
  locale = DEFAULT_LOCALE,
}: {
  card: ReportCard;
  locale?: Locale;
}) {
  // The locale arrives as a prop because this renders inside a Server
  // Component, where `useI18n()` would throw (rule 15). The translator is
  // built from it rather than fetched, so the component stays pure.
  const t = createTranslator(locale);
  const papers = card.papers ?? [];
  const rank = rankSentence(card.rank, t);
  const attendance = attendancePercent(card.attendance);
  const failed = card.totals.result === "fail";
  const incomplete = card.totals.result === "incomplete";

  return (
    <article
      data-print="page"
      className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
      aria-label={t("reportCard.aria", { name: card.student.name })}
    >
      <div data-print="sheet" className="p-6 sm:p-8">
        {card.provisional ? (
          <div
            data-print="keep"
            className="mb-6 flex items-start gap-2 rounded-md border border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10 p-3"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-[color:var(--color-accent)]"
            />
            <p className="text-sm">
              <span className="font-semibold">{t("reportCard.provisional")}</span>{" "}
              {t("reportCard.provisionalScreen")}
            </p>
          </div>
        ) : null}

        <header className="border-b border-border pb-4">
          <h2 className="font-mono text-lg font-semibold tracking-tight">{card.school.name}</h2>
          <p className="text-sm text-muted-foreground">
            {card.exam.name} · {t("reportCard.session", { name: card.session.name })}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border py-4 sm:grid-cols-4">
          <Field label={t("reportCard.student")} value={card.student.name} />
          <Field label={t("reportCard.class")} value={card.student.section} />
          <Field label={t("reportCard.roll")} value={card.student.roll_number} />
          <Field label={t("reportCard.admission")} value={card.student.admission_number} />
        </dl>

        <div className="overflow-x-auto py-4">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">
              {t("reportCard.caption", { name: card.student.name, exam: card.exam.name })}
            </caption>
            <thead>
              <tr className="border-b border-border text-start">
                <th scope="col" className="py-2 pe-3 font-medium">
                  {t("reportCard.subject")}
                </th>
                <th scope="col" className="py-2 pe-3 text-end font-medium">
                  {t("reportCard.marks")}
                </th>
                <th scope="col" className="py-2 pe-3 text-end font-medium">
                  {t("reportCard.outOf")}
                </th>
                <th scope="col" className="py-2 pe-3 text-end font-medium">
                  {t("reportCard.passMark")}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t("reportCard.result")}
                </th>
              </tr>
            </thead>
            <tbody>
              {papers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    {t("reportCard.noPapers")}
                  </td>
                </tr>
              ) : (
                papers.map((paper, index) => {
                  const note = paperNote(paper, t);
                  return (
                    <tr
                      key={`${paper.code ?? paper.subject}-${index}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <th scope="row" className="py-2 pe-3 text-start font-normal">
                        <span className="font-medium">{paper.subject}</span>
                        {paper.optional ? (
                          <span className="ms-2 text-xs text-muted-foreground">{t("reportCard.additional")}</span>
                        ) : null}
                        {paper.components && paper.components.length > 0 ? (
                          // The working, on the card. A parent looking at 68/100
                          // with "Fail" beside it is owed the sentence that
                          // explains it, and the sentence is the practical mark.
                          <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                            {paper.components
                              .map(
                                (part) =>
                                  `${part.name} ${
                                    part.absent
                                      ? "AB"
                                      : part.obtained === null
                                        ? "—"
                                        : Number(part.obtained)
                                  }/${Number(part.max)}`,
                              )
                              .join(" · ")}
                          </span>
                        ) : null}
                        {note ? (
                          <span className="block text-xs text-muted-foreground">{note}</span>
                        ) : null}
                      </th>
                      <td className="py-2 pe-3 text-end font-mono tabular-nums">
                        {paperMark(paper)}
                      </td>
                      <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted-foreground">
                        {Number(paper.max)}
                      </td>
                      <td className="py-2 pe-3 text-end font-mono tabular-nums text-muted-foreground">
                        {Number(paper.pass)}
                      </td>
                      <td className="py-2">
                        {/* Text, never colour alone: a card is photocopied in
                            black and white more often than it is read on a
                            screen. */}
                        {paper.absent ? (
                          <span className="text-muted-foreground">{t("reportCard.absent")}</span>
                        ) : paper.passed ? (
                          <span>{t("reportCard.pass")}</span>
                        ) : (
                          <span className="font-medium text-destructive">{t("reportCard.fail")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-4">
          <Field
            label={t("reportCard.total")}
            value={t("reportCard.totalValue", { obtained: Number(card.totals.obtained), max: Number(card.totals.max) })}
            mono
          />
          <Field label={t("reportCard.percentage")} value={formatPercent(card.totals.percentage)} mono />
          <Field
            label={t("reportCard.grade")}
            value={
              card.totals.grade
                ? card.totals.grade_point !== null
                  ? `${card.totals.grade} (${Number(card.totals.grade_point)})`
                  : card.totals.grade
                : t("reportCard.notGraded")
            }
            mono
          />
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("reportCard.result")}
            </dt>
            <dd className="mt-1">
              <Badge
                variant={failed ? "destructive" : incomplete ? "secondary" : "default"}
                className="font-medium"
              >
                {resultLabel(card.totals.result, t)}
              </Badge>
            </dd>
          </div>
        </dl>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
          <Field
            label={t("reportCard.position")}
            value={rank ?? t("reportCard.noRank")}
            hint={card.provisional && !rank ? t("reportCard.rankLater") : undefined}
          />
          <Field
            label={t("reportCard.attendance")}
            value={attendanceSentence(card.attendance, t)}
            hint={
              attendance !== null
                ? t("reportCard.presentPercent", { percent: attendance }) +
                  (card.attendance?.upto ? `, ${t("reportCard.upTo", { date: card.attendance.upto })}` : "")
                : undefined
            }
          />
        </dl>

        {card.behaviour && card.behaviour.length > 0 ? (
          <div data-print="keep" className="border-t border-border py-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("reportCard.behaviour")}
            </h3>
            <div className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
              {(["behaviour", "skill"] as const).map((kind) => {
                const rows = card.behaviour!.filter((b) => b.kind === kind);
                if (rows.length === 0) return null;
                return (
                  <dl key={kind} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                    {rows.map((b) => (
                      <div key={b.name} className="contents">
                        <dt>{b.name}</dt>
                        <dd className="text-end font-mono font-medium">{b.grade}</dd>
                      </div>
                    ))}
                  </dl>
                );
              })}
            </div>
            {card.behaviour_legend && (
              <p className="mt-2 text-xs text-muted-foreground">{card.behaviour_legend}</p>
            )}
          </div>
        ) : null}

        {card.remark ? (
          <div data-print="keep" className="border-t border-border pt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("reportCard.remark")}
            </h3>
            <p className="mt-1 text-sm">{card.remark.text}</p>
          </div>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            {card.student.class_teacher
              ? t("reportCard.classTeacher", { name: card.student.class_teacher })
              : t("reportCard.classTeacherNone")}
          </p>
          <p>
            {card.exam.published_at
              ? t("reportCard.published", { date: formatDate(card.exam.published_at, locale) })
              : t("reportCard.notPublished")}
          </p>
        </footer>
      </div>
    </article>
  );
}

function Field({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string | null;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-sm ${mono ? "font-mono tabular-nums" : ""}`}>
        {value && value.trim() !== "" ? value : "—"}
      </dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
