import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../../students/actions";
import { listExams } from "../../actions";
import { getSectionCards } from "../../report-card-actions";
import { ReportCardSheet } from "@/components/report-card/report-card-sheet";
import { SectionPicker } from "./section-picker";
import { PrintButton } from "./print-button";

export const metadata = { title: "Report cards" };

export default async function ReportCardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { examId } = await params;
  const { section } = await searchParams;

  const [exams, sections, canView] = await Promise.all([
    listExams(),
    listSections(),
    hasPermission("exams.view"),
  ]);

  const exam = exams.find((e) => e.id === examId);
  if (!exam) notFound();

  if (!canView) {
    return (
      <Empty
        title="Report cards"
        body="Report cards are visible to staff who can see marks. Ask an administrator to grant you exams.view."
      />
    );
  }

  // No section chosen yet is a real state, not an empty one: printing every
  // card in the school at once is exactly what rule 7 says not to do, so the
  // screen asks which class rather than guessing.
  const chosen = section && sections.some((s) => s.id === section) ? section : null;
  const { cards, unreadable } = chosen
    ? await getSectionCards(examId, chosen)
    : { cards: [], unreadable: 0 };

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Report cards</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {exam.name} ·{" "}
            {exam.status === "published"
              ? "Published, so every card below is the frozen one — a reprint matches the card that went home."
              : "This exam is still a draft, so these cards are provisional and carry no position."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}/remarks`}>
              <MessageSquare className="size-4" aria-hidden="true" />
              Remarks
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/exams/${examId}`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to exam
            </Link>
          </Button>
        </div>
      </div>

      <div
        data-print="hide"
        className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4"
      >
        <SectionPicker examId={examId} sections={sections} value={chosen} />
        {cards.length > 0 ? <PrintButton count={cards.length} /> : null}
      </div>

      {unreadable > 0 ? (
        <p
          data-print="hide"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {unreadable} card{unreadable === 1 ? "" : "s"} could not be read and {unreadable === 1 ? "was" : "were"}{" "}
          left out rather than printed half-built. Check the exam&apos;s papers and marks.
        </p>
      ) : null}

      {!chosen ? (
        <Empty
          title="Choose a class"
          body="Cards are printed a class at a time — a school-wide run belongs in a queued job, not in a page load."
        />
      ) : cards.length === 0 ? (
        <Empty
          title="No cards for this class"
          body={
            exam.status === "published"
              ? "Nobody in this class has a published result for this exam."
              : "No marks have been entered for this class yet."
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {cards.map((card) => (
            <ReportCardSheet key={card.student.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      data-print="hide"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center"
    >
      <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
