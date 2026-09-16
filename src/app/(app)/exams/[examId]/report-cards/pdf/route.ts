import { getSectionCards } from "../../../report-card-actions";
import { hasPermission } from "@/lib/auth/permissions";
import { getT, getLocale } from "@/lib/i18n/server";
import { resultLabel } from "@/lib/validations/exams";
import { formatDate } from "@/lib/i18n/format";
import { renderReportCards } from "@/lib/pdf/report-card";
import { UnrenderableDocument, pdfFileName } from "@/lib/pdf/document";

/**
 * A class of report cards, as one file.
 *
 * ## Why this one checks a permission and the family's card does not
 *
 * The single-card route two modules over deliberately has no permission check:
 * `exams_report_card` is row-scoped, so *"may I see this child's card"* is a
 * question Postgres already answers and a second answer would be a second
 * place to get it wrong.
 *
 * **"May I pull a whole class" is not that question.** It is the distinction
 * rule 4 draws between `staff_record` and `staff_roster` — one is about a row
 * and the other is about a *list* — and the screen this route is the file
 * version of already answers it with `exams.view`. So the route answers it the
 * same way, because a menu and a boundary that disagree are worse than either.
 *
 * Below that, nothing changes: `exams_report_cards` is `SECURITY INVOKER`, so a
 * class teacher holding `exams.view` still gets only the children RLS lets them
 * read, and the file contains exactly what the screen would show them.
 *
 * ## The bound
 *
 * A section, and the section is named in the query string rather than
 * defaulted. `getSectionCards` requires one; there is no *"every class"* value,
 * because a school-wide run is 5.5 seconds and 754 kB — which is the queued job
 * `docs/modules/pdf.md` names and this is deliberately not.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const { examId } = await params;
  const sectionId = new URL(request.url).searchParams.get("section");

  const [canView, t, locale] = await Promise.all([
    hasPermission("exams.view"),
    getT(),
    getLocale(),
  ]);

  // The same flat answer for "no permission" and "no such section", for the
  // same reason every 404 in this product is flat: a message that told them
  // apart is a way of asking which sections exist.
  if (!canView || !sectionId) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { cards } = await getSectionCards(examId, sectionId);
  if (cards.length === 0) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const bytes = await renderReportCards(
      cards.map((card) => ({
        card,
        resultLabel: resultLabel(card.totals.result, t),
        publishedOn: card.exam.published_at ? formatDate(card.exam.published_at, locale) : null,
      })),
    );

    // The class, not a child: this file is opened by an office, and
    // `Grade-4-A-Half-Yearly-Examination.pdf` is what they filed it under.
    const first = cards[0];
    const stem = `${first.student.section ?? "class"}-${first.exam.name}`;
    const name = pdfFileName(first.provisional ? `${stem}-provisional` : stem);

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
        // Never cached: a class list changes, a draft changes, and a shared
        // cache holding a whole class's marks is the worst version of the
        // storage rule's "never render a signed link into a page".
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnrenderableDocument) {
      return new Response(error.message, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}
