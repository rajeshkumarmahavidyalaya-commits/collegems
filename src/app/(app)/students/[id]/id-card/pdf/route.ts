import { getIdCard } from "../../../id-cards/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { getT, getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { photoBytes } from "@/lib/storage/photos";
import { cardGaps, isPrintable, studentFace } from "@/lib/validations/id-card";
import { UnfinishedCard, idCardFileName, renderIdCard } from "@/lib/pdf/card";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * One child's identity card, as a file.
 *
 * ## Why this refuses where the screen prints
 *
 * `cardGaps()` has marked a missing photograph `blocking: true` since the module
 * shipped, and nothing anywhere acted on it — `blocking` chose a CSS class. The
 * screen drew a dashed placeholder and printed.
 *
 * A file is where that stops being a style. Printing is the school's own paper
 * in the school's own tray and a half-finished card can be looked at and thrown
 * away; a PDF goes to a card printer or a print shop and comes back as a stack
 * of plastic. So this answers **422 with the sentence**, and the page does not
 * offer the link at all — one predicate, `isPrintable`, consulted by both, so
 * the button and the boundary cannot disagree.
 *
 * ## The photograph is fetched, not linked
 *
 * `photoBytes` downloads the object; `photoUrl` is never called here. A PDF
 * embeds an image and has no browser to follow a link, so minting a signed URL
 * to fetch bytes this process can read directly would be signing something
 * nobody asked for.
 *
 * ## Who may have it
 *
 * `students.view`, mirroring the page — RLS on `students` is row-ownership, so
 * a class teacher gets their own children and `getIdCard` returns nothing for
 * anybody else's. The permission is what the page already checks, and a file
 * version of a screen that checked something different would be the menu and
 * the boundary disagreeing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [canView, result, t, locale] = await Promise.all([
    hasPermission("students.view"),
    getIdCard(id),
    getT(),
    getLocale(),
  ]);

  if (!canView || !result) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { card, school } = result;
  if (!isPrintable(cardGaps(card, t))) {
    return new Response(new UnfinishedCard(card.fullName).message, {
      status: 422,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const photo = await photoBytes(card.photoPath);
  if (!photo) {
    // The row says there is a photograph and the object is not there. A
    // sentence, not a 500: the record is intact and this is somebody's job.
    return new Response(new UnfinishedCard(card.fullName).message, {
      status: 422,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const face = studentFace(card, t, formatDate, locale);

  try {
    const bytes = await renderIdCard({
      fullName: face.fullName,
      subtitle: face.subtitle,
      facts: face.facts,
      schoolName: school.name,
      sessionName: school.sessionName,
      photo,
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${idCardFileName(card.fullName)}"`,
        // `no-store`, and this one is not a judgement call: a card is a
        // statement about **now**, so a cached copy is last year's class on
        // this year's card — and it carries a child's photograph.
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnrenderableDocument || error instanceof UnfinishedCard) {
      return new Response(error.message, {
        status: 422,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }
}
