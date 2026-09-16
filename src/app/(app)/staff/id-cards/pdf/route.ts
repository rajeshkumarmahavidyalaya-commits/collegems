import { getStaffCards } from "../actions";
import { getT } from "@/lib/i18n/server";
import { staffFace } from "@/lib/validations/id-card";
import { CardSetTooLarge, cardDocuments } from "@/lib/pdf/card-set";
import { UnfinishedCard, idCardFileName, renderIdCards } from "@/lib/pdf/card";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A department's identity cards, as one file.
 *
 * The student route's twin, with the same two bounds — and, like the single
 * staff card, **no permission check of its own**: `getStaffCards` checks
 * `staff.view` inside the function that produces the data, because RLS on
 * `staff` is role-wide and the matrix is the only thing that narrows it. A copy
 * here is where a rule starts to differ from itself.
 *
 * The department is optional, unlike the student route's section: the staff of
 * a college is bounded by the staff of a college, and `getStaffCards` refuses
 * past `MAX_CARDS_PER_RUN` either way.
 */
export async function GET(request: Request) {
  const department = new URL(request.url).searchParams.get("department") ?? undefined;
  const [result, t] = await Promise.all([getStaffCards(department), getT()]);

  if (!result.ok || result.cards.length === 0) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const docs = await cardDocuments(
      result.cards.map((card) => ({ ...staffFace(card, t), photoPath: card.photoPath })),
      result.school,
    );
    const bytes = await renderIdCards(docs);

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${idCardFileName(department ?? "staff", true)}"`,
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
