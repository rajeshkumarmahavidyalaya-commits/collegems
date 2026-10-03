import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Armchair, IdCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { listSections } from "../../../students/actions";
import { getExam } from "../../actions";
import { getAdmitCards, type AdmitCard } from "../../admit-card-actions";
import { SectionPicker } from "../report-cards/section-picker";
import { PrintButton } from "../report-cards/print-button";
import type { Locale } from "@/lib/i18n/config";

export const metadata = { title: "Admit cards" };

/**
 * The reference's "View Admit Cards" for one exam: a class at a time, one card
 * per child, printed by the browser. Every line on the card is read from a row
 * (`exams_admit_cards`, 0322) -- the papers the child sits, each paper's date
 * and period, and the seat from a *published* seat plan -- so a card cannot
 * promise a seat the officer is still moving.
 */
export default async function AdmitCardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { examId } = await params;
  const { section } = await searchParams;
  const [exam, sections, canManage, ctx, locale] = await Promise.all([
    getExam(examId),
    listSections(),
    hasPermission("exams.manage"),
    getUserContext(),
    getLocale(),
  ]);
  if (!exam) notFound();

  const toolbar = (
    <PageToolbar title={`Admit Cards: ${exam.name}`} icon={IdCard}>
      <Button asChild variant="outline">
        <Link href="/exams/admit-cards">
          <ArrowLeft className="size-4" aria-hidden="true" />
          All exams
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={`/exams/${examId}/seating`}>
          <Armchair className="size-4" aria-hidden="true" />
          Seating
        </Link>
      </Button>
    </PageToolbar>
  );

  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <p className="max-w-2xl text-sm text-muted-foreground">
          Admit cards are printed by the examination office, which needs <code>exams.manage</code>.
        </p>
      </div>
    );
  }

  const chosen = section && sections.some((s) => s.id === section) ? section : null;
  const result = chosen ? await getAdmitCards(examId, chosen) : null;
  const cards = result?.ok ? result.cards : [];
  const unseated = cards.reduce((n, c) => n + c.papers.filter((p) => p.seatNo === null).length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div data-print="hide">{toolbar}</div>

      <div data-print="hide" className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
        <SectionPicker examId={examId} sections={sections} value={chosen} page="admit-cards" />
        {cards.length > 0 && <PrintButton count={cards.length} />}
      </div>

      {result && !result.ok && (
        <p data-print="hide" role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {result.error}
        </p>
      )}

      {cards.length > 0 && unseated > 0 && (
        <p data-print="hide" role="status" className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
          {unseated === 1 ? "One paper has" : `${unseated} papers have`} no seat on these cards, because no
          seat plan covering {unseated === 1 ? "it" : "them"} has been published. Publish the plan under{" "}
          <Link href={`/exams/${examId}/seating`} className="underline">
            Seating
          </Link>{" "}
          and reprint, or print now and seat on the day.
        </p>
      )}

      {!chosen ? (
        <Empty title="Choose a class" body="Admit cards are printed a class at a time." />
      ) : result?.ok && cards.length === 0 ? (
        <Empty title="No cards for this class" body="Nobody is enrolled in this class for the exam's year." />
      ) : (
        <div className="grid gap-6">
          {cards.map((card) => (
            <AdmitCardSheet
              key={card.studentId}
              card={card}
              school={ctx?.tenantName ?? ""}
              examName={exam.name}
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function hhmm(value: string | null) {
  return value ? value.slice(0, 5) : null;
}

function AdmitCardSheet({
  card,
  school,
  examName,
  locale,
}: {
  card: AdmitCard;
  school: string;
  examName: string;
  locale: Locale;
}) {
  const dash = "—";
  return (
    <article
      data-print="keep"
      className="min-w-0 rounded-lg border-2 border-foreground/70 bg-card p-5 text-card-foreground print:mb-6"
      aria-label={`Admit card for ${card.fullName}`}
    >
      <header className="border-b pb-3 text-center">
        <p className="text-lg font-semibold">{school}</p>
        <p className="text-sm">{examName}</p>
        <p className="mt-1 text-xs font-semibold tracking-widest uppercase">Admit Card</p>
      </header>
      <dl className="grid gap-x-6 gap-y-1 py-3 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Name:</dt>
          <dd className="font-medium">{card.fullName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Admission Number:</dt>
          <dd className="font-mono">{card.admissionNumber}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Class:</dt>
          <dd>
            {card.className ?? dash} · {card.sectionName ?? dash}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Roll Number:</dt>
          <dd>{card.rollNumber ?? dash}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Date of Birth:</dt>
          <dd>{card.dateOfBirth ? formatDate(card.dateOfBirth, locale) : dash}</dd>
        </div>
      </dl>
      {card.papers.length === 0 ? (
        <p className="border-t py-3 text-sm text-muted-foreground">
          This exam has no papers for this class yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y text-start">
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">Subject</th>
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">Date</th>
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">Time</th>
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">Room</th>
                <th scope="col" className="py-1.5 text-start font-medium">Seat</th>
              </tr>
            </thead>
            <tbody>
              {card.papers.map((p) => (
                <tr key={p.examSubjectId} className="border-b">
                  <td className="py-1.5 pe-3">
                    {p.subject}
                    {p.code ? <span className="ms-1 font-mono text-xs text-muted-foreground">({p.code})</span> : null}
                  </td>
                  <td className="py-1.5 pe-3 whitespace-nowrap">{p.date ? formatDate(p.date, locale) : dash}</td>
                  <td className="py-1.5 pe-3 whitespace-nowrap">
                    {p.startsAt ? `${hhmm(p.startsAt)}–${hhmm(p.endsAt)}` : (p.slot ?? dash)}
                  </td>
                  <td className="py-1.5 pe-3">{p.room ?? dash}</td>
                  <td className="py-1.5">{p.seatNo ?? dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="mt-8 flex justify-between text-xs text-muted-foreground">
        <span className="border-t border-foreground/50 px-6 pt-1">Candidate&apos;s signature</span>
        <span className="border-t border-foreground/50 px-6 pt-1">Controller of examinations</span>
      </footer>
    </article>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div data-print="hide" className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
