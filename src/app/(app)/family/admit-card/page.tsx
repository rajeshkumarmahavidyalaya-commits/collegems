import Link from "next/link";
import { IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/i18n/format";
import { PrintButton } from "../print-button";
import { getExams } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Exam Admit Card" };

const time = (t: string | null) => (t ? t.slice(0, 5) : null);

/**
 * The child's admit card for one exam, printed by the browser. The papers are
 * the ones the child sits; a room and seat appear only once the seat plan is
 * published, and a paper without one prints a dash rather than a guess.
 */
export default async function FamilyAdmitCardPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; exam?: string }>;
}) {
  const { child: requested, exam: examId } = await searchParams;
  const { isFamily, childList, child, locale, ctx } = await loadFamilyPage(requested);
  const exams = child ? await getExams(child.studentId) : [];
  const exam = exams.find((x) => x.examId === examId) ?? exams[0] ?? null;

  let schoolName: string | null = null;
  if (exam) {
    const supabase = await createClient();
    const { data } = await supabase.from("tenants").select("name").limit(1).maybeSingle();
    schoolName = data?.name ?? null;
  }
  const unseated = exam ? exam.papers.filter((p) => p.seatNo === null).length : 0;

  return (
    <FamilyFrame
      title="Exam Admit Card"
      icon={IdCard}
      isFamily={isFamily}
      childList={childList}
      child={child}
      actions={exam ? <PrintButton /> : undefined}
    >
      {!exam ? (
        <EmptyCard icon={IdCard} title="No exam to print a card for" body="An admit card is available once an exam is scheduled for this class." />
      ) : (
        <>
          {exams.length > 1 && (
            <nav aria-label="Exams" className="flex flex-wrap gap-2" data-print="hide">
              {exams.map((x) => (
                <Button key={x.examId} asChild size="sm" variant={x.examId === exam.examId ? "default" : "outline"}>
                  <Link href={`/family/admit-card?exam=${x.examId}&child=${child!.studentId}`}>{x.examName}</Link>
                </Button>
              ))}
            </nav>
          )}
          <article data-print="sheet" className="mx-auto w-full max-w-3xl rounded-lg border bg-card p-6">
            <header className="mb-4 text-center">
              <p className="text-lg font-semibold">{schoolName ?? ""}</p>
              <p className="text-sm text-muted-foreground">Admit Card · {exam.examName}</p>
              {exam.centre && <p className="text-sm">Exam centre: {exam.centre}</p>}
            </header>
            <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-muted-foreground">Name: </dt>
                <dd className="inline font-medium">{child!.name}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Admission Number: </dt>
                <dd className="inline font-medium">{child!.admissionNumber}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Class: </dt>
                <dd className="inline font-medium">{child!.sectionLabel ?? "—"}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Roll Number: </dt>
                <dd className="inline font-medium">{child!.rollNumber ?? "—"}</dd>
              </div>
              {ctx?.currentSessionName && (
                <div>
                  <dt className="inline text-muted-foreground">Session: </dt>
                  <dd className="inline font-medium">{ctx.currentSessionName}</dd>
                </div>
              )}
            </dl>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Seat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exam.papers.map((p) => (
                    <TableRow key={p.paperId}>
                      <TableCell className="font-medium">
                        {p.subject}
                        {p.code ? ` (${p.code})` : ""}
                      </TableCell>
                      <TableCell>{p.date ? formatDate(p.date, locale) : "—"}</TableCell>
                      <TableCell>
                        {time(p.startsAt) && time(p.endsAt) ? `${time(p.startsAt)}–${time(p.endsAt)}` : (p.slot ?? "—")}
                      </TableCell>
                      <TableCell>{p.room ?? "—"}</TableCell>
                      <TableCell>{p.seatNo ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </article>
          {unseated > 0 && (
            <p className="text-sm text-muted-foreground" data-print="hide">
              {unseated === 1
                ? "One paper has no seat yet: the college has not published its seating plan."
                : `${unseated} papers have no seat yet: the college has not published their seating plans.`}
            </p>
          )}
        </>
      )}
    </FamilyFrame>
  );
}
