import { getStudentCard } from "../../../../exams/report-card-actions";
import { getT, getLocale } from "@/lib/i18n/server";
import { resultLabel } from "@/lib/validations/exams";
import { formatDate } from "@/lib/i18n/format";
import { renderReportCard, reportCardFileName } from "@/lib/pdf/report-card";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A report card, as a file.
 *
 * ## Who may have it
 *
 * `getStudentCard` calls `exams_report_card`, which is `SECURITY INVOKER` and
 * refuses in two directions of its own — *"You cannot see that student's report
 * card"* and *"These results have not been published yet"*. So **RLS and the
 * function are the whole gate**, exactly as they are for the page one directory
 * up, and there is deliberately no permission check here: a second answer to a
 * question Postgres already answers is a second place to get it wrong.
 *
 * A guardian gets their own child's card and nobody else's, because
 * `exams_may_see_student` says so; a class teacher gets the children they
 * teach; a draft reaches staff only.
 *
 * ## 404, and the copy
 *
 * The two refusals collapse into one answer for the same reason the page's
 * empty state does: *not published yet* and *not yours* must not be
 * distinguishable, or iterating over student ids tells somebody which children
 * are in which class. The page says as much in prose; a route handler has only
 * a status line, so it says nothing at all.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ studentId: string; examId: string }> },
) {
  const { studentId, examId } = await params;
  const card = await getStudentCard(examId, studentId);
  if (!card) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const [t, locale] = await Promise.all([getT(), getLocale()]);

  try {
    const bytes = await renderReportCard({
      card,
      resultLabel: resultLabel(card.totals.result, t),
      publishedOn: card.exam.published_at ? formatDate(card.exam.published_at, locale) : null,
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${reportCardFileName(card)}"`,
        // A published card is frozen, so the bytes for one child and one exam
        // do not change — but a **draft** card is not, and `no-store` is the
        // honest header for the pair rather than a cache directive that is
        // right half the time. `private` either way: a shared cache holding a
        // child's marks is the storage rule's "never render a signed link into
        // a page" wearing an HTTP header.
        "cache-control": card.provisional
          ? "private, no-store"
          : "private, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    if (error instanceof UnrenderableDocument) {
      // 422, not 500: the request was understood, the row is intact, and this
      // build genuinely cannot draw the script. A fact about the font, stated.
      return new Response(error.message, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}
