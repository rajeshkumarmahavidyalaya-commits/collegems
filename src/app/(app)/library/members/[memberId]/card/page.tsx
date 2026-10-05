import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { PrintButton } from "../../../../exams/[examId]/report-cards/print-button";
import { getMemberCard } from "../../../actions";

export const metadata = { title: "Library card" };

/**
 * The reference's "Print" on a library card: one card, printed by the browser.
 * Every line is read from the card's own row and its holder's, through RLS, so
 * a card that is not the caller's to see is the same 404 as one that does not
 * exist.
 */
export default async function LibraryCardPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const [card, ctx, locale] = await Promise.all([getMemberCard(memberId), getUserContext(), getLocale()]);
  if (!card) notFound();

  const dash = "—";
  return (
    <div className="flex flex-col gap-4">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Library Card</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/library/members">
              <ArrowLeft className="size-4" aria-hidden="true" />
              All cards
            </Link>
          </Button>
          <PrintButton count={1} />
        </div>
      </div>
      <article
        data-print="keep"
        className="max-w-md rounded-lg border-2 border-foreground/70 bg-card p-5 text-card-foreground"
        aria-label={`Library card for ${card.holderName}`}
      >
        <header className="border-b pb-3 text-center">
          <p className="text-lg font-semibold">{ctx?.tenantName ?? ""}</p>
          <p className="text-xs font-semibold tracking-widest uppercase">Library Card</p>
        </header>
        <dl className="grid gap-y-1 py-3 text-sm">
          <Row label="Card Number" value={<span className="font-mono">{card.membershipNumber}</span>} />
          <Row label="Name" value={<span className="font-medium">{card.holderName}</span>} />
          <Row
            label={card.holderType === "Student" ? "Enrollment Number" : "Employee Code"}
            value={<span className="font-mono">{card.holderRef}</span>}
          />
          {card.holderType === "Student" && (
            <Row label="Class" value={card.className ? `${card.className} · ${card.sectionName}` : dash} />
          )}
          <Row label="Date Issued" value={formatDate(card.joinedAt, locale)} />
          <Row label="Books at a time" value={String(card.maxBooks)} />
        </dl>
        <footer className="mt-6 flex justify-end text-xs text-muted-foreground">
          <span className="border-t border-foreground/50 px-6 pt-1">Librarian</span>
        </footer>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd>{value}</dd>
    </div>
  );
}
