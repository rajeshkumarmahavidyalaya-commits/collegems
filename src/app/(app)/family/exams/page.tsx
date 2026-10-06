import Link from "next/link";
import { CalendarClock, IdCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import { getExams } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Exams Time Table" };

const time = (t: string | null) => (t ? t.slice(0, 5) : null);

/**
 * This year's exams and the papers the child sits, from `family_exam_papers`
 * (electives the child did not choose are not listed). The admit card reads
 * the same rows.
 */
export default async function FamilyExamsPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { child: requested } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const exams = child ? await getExams(child.studentId) : [];

  return (
    <FamilyFrame title="Exams Time Table" icon={CalendarClock} isFamily={isFamily} childList={childList} child={child}>
      {exams.length === 0 ? (
        <EmptyCard
          icon={CalendarClock}
          title="No exams scheduled this year"
          body="When the college schedules an exam for this class, its papers and dates appear here."
        />
      ) : (
        exams.map((x) => (
          <Card key={x.examId}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{x.examName}</CardTitle>
                <CardDescription>
                  {x.startsOn ? formatDate(x.startsOn, locale) : "Dates not set"}
                  {x.endsOn && x.endsOn !== x.startsOn ? ` to ${formatDate(x.endsOn, locale)}` : ""}
                  {x.centre ? ` · Centre: ${x.centre}` : ""}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={x.examStatus === "published" ? "default" : "secondary"}>
                  {x.examStatus === "published" ? "Results published" : "Scheduled"}
                </Badge>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/family/admit-card?exam=${x.examId}${child ? `&child=${child.studentId}` : ""}`}>
                    <IdCard className="size-4" aria-hidden="true" />
                    Admit card
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-end">Maximum Marks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {x.papers.map((p) => (
                    <TableRow key={p.paperId}>
                      <TableCell className="font-medium">{p.subject}</TableCell>
                      <TableCell>{p.code ?? "—"}</TableCell>
                      <TableCell>{p.date ? formatDate(p.date, locale) : "Not set"}</TableCell>
                      <TableCell>
                        {time(p.startsAt) && time(p.endsAt) ? `${time(p.startsAt)}–${time(p.endsAt)}` : (p.slot ?? "—")}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{p.maxMarks}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </FamilyFrame>
  );
}
