import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPercent, resultLabel } from "@/lib/validations/exams";
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
export function ReportCardSheet({ card }: { card: ReportCard }) {
  const papers = card.papers ?? [];
  const rank = rankSentence(card.rank);
  const attendance = attendancePercent(card.attendance);
  const failed = card.totals.result === "fail";
  const incomplete = card.totals.result === "incomplete";

  return (
    <article
      data-print="page"
      className="rounded-lg border border-border bg-card text-card-foreground shadow-sm"
      aria-label={`Report card for ${card.student.name}`}
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
              <span className="font-semibold">Provisional.</span> These results have not been
              published, so they can still change and no position has been worked out. Do not hand
              this to a parent.
            </p>
          </div>
        ) : null}

        <header className="border-b border-border pb-4">
          <h2 className="font-mono text-lg font-semibold tracking-tight">{card.school.name}</h2>
          <p className="text-sm text-muted-foreground">
            {card.exam.name} · Session {card.session.name}
          </p>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border py-4 sm:grid-cols-4">
          <Field label="Student" value={card.student.name} />
          <Field label="Class" value={card.student.section} />
          <Field label="Roll number" value={card.student.roll_number} />
          <Field label="Admission number" value={card.student.admission_number} />
        </dl>

        <div className="overflow-x-auto py-4">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">
              Subject-wise marks for {card.student.name} in {card.exam.name}
            </caption>
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Subject
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Marks
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Out of
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Pass mark
                </th>
                <th scope="col" className="py-2 font-medium">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {papers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No papers were recorded for this exam.
                  </td>
                </tr>
              ) : (
                papers.map((paper, index) => {
                  const note = paperNote(paper);
                  return (
                    <tr
                      key={`${paper.code ?? paper.subject}-${index}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <span className="font-medium">{paper.subject}</span>
                        {paper.optional ? (
                          <span className="ml-2 text-xs text-muted-foreground">(additional)</span>
                        ) : null}
                        {note ? (
                          <span className="block text-xs text-muted-foreground">{note}</span>
                        ) : null}
                      </th>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {paperMark(paper)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                        {Number(paper.max)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                        {Number(paper.pass)}
                      </td>
                      <td className="py-2">
                        {/* Text, never colour alone: a card is photocopied in
                            black and white more often than it is read on a
                            screen. */}
                        {paper.absent ? (
                          <span className="text-muted-foreground">Absent</span>
                        ) : paper.passed ? (
                          <span>Pass</span>
                        ) : (
                          <span className="font-medium text-destructive">Fail</span>
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
            label="Total"
            value={`${Number(card.totals.obtained)} of ${Number(card.totals.max)}`}
            mono
          />
          <Field label="Percentage" value={formatPercent(card.totals.percentage)} mono />
          <Field
            label="Grade"
            value={
              card.totals.grade
                ? card.totals.grade_point !== null
                  ? `${card.totals.grade} (${Number(card.totals.grade_point)})`
                  : card.totals.grade
                : "Not graded"
            }
            mono
          />
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Result
            </dt>
            <dd className="mt-1">
              <Badge
                variant={failed ? "destructive" : incomplete ? "secondary" : "default"}
                className="font-medium"
              >
                {resultLabel(card.totals.result)}
              </Badge>
            </dd>
          </div>
        </dl>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 py-4 sm:grid-cols-2">
          <Field
            label="Position"
            value={rank ?? "This school does not rank"}
            hint={
              card.provisional && !rank
                ? "Positions are worked out when results are published."
                : undefined
            }
          />
          <Field
            label="Attendance"
            value={attendanceSentence(card.attendance)}
            hint={
              attendance !== null
                ? `${attendance}% present${
                    card.attendance?.upto ? `, up to ${card.attendance.upto}` : ""
                  }`
                : undefined
            }
          />
        </dl>

        {card.remark ? (
          <div data-print="keep" className="border-t border-border pt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Class teacher&apos;s remark
            </h3>
            <p className="mt-1 text-sm">{card.remark.text}</p>
          </div>
        ) : null}

        <footer className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            {card.student.class_teacher
              ? `Class teacher: ${card.student.class_teacher}`
              : "Class teacher not recorded"}
          </p>
          <p>
            {card.exam.published_at
              ? `Published ${new Date(card.exam.published_at).toLocaleDateString()}`
              : "Not yet published"}
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
