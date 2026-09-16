import { getIdCards } from "../actions";
import { hasPermission } from "@/lib/auth/permissions";
import { getT, getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { studentFace } from "@/lib/validations/id-card";
import { CardSetTooLarge, cardDocuments } from "@/lib/pdf/card-set";
import { UnfinishedCard, idCardFileName, renderIdCards } from "@/lib/pdf/card";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A class of identity cards, as one file, one card to a page.
 *
 * ## Why CR80 pages rather than eight-up on A4
 *
 * The **screen** already prints eight to an A4 sheet, which is what a school
 * with a guillotine and a laser printer wants, and that is kept. This is for
 * the other machine:
 *
 * > A sheet of eight is for a school's own printer. A file of CR80 pages is for
 * > a card printer, or for the print shop down the road — which is what a
 * > school with four hundred children actually uses.
 *
 * ## Two bounds, and the count is not the interesting one
 *
 * `getIdCards` already refuses past `MAX_CARDS_PER_RUN`. **A bound on rows is
 * not a bound on bytes**: the `avatars` bucket admits 5 MB objects, so a
 * hundred and twenty of them is 600 MB that no count would notice. The second
 * bound is in `cardDocuments`, and it refuses with the number rather than
 * quietly producing a short file.
 */
export async function GET(request: Request) {
  const sectionId = new URL(request.url).searchParams.get("section");
  const [canView, t, locale] = await Promise.all([
    hasPermission("students.view"),
    getT(),
    getLocale(),
  ]);

  if (!canView || !sectionId) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const result = await getIdCards(sectionId);
  if (!result.ok || result.cards.length === 0) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const docs = await cardDocuments(
      result.cards.map((card) => {
        const face = studentFace(card, t, formatDate, locale);
        return { ...face, photoPath: card.photoPath };
      }),
      result.school,
    );
    const bytes = await renderIdCards(docs);
    const label = result.cards[0].className ?? "class";

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${idCardFileName(label, true)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (
      error instanceof UnfinishedCard ||
      error instanceof CardSetTooLarge ||
      error instanceof UnrenderableDocument
    ) {
      return new Response(error.message, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}
