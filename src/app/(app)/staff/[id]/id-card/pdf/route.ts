import { getStaffCard } from "../../../id-cards/actions";
import { getT } from "@/lib/i18n/server";
import { photoBytes } from "@/lib/storage/photos";
import { isPrintable, staffCardGaps, staffFace } from "@/lib/validations/id-card";
import { UnfinishedCard, idCardFileName, renderIdCard } from "@/lib/pdf/card";
import { UnrenderableDocument } from "@/lib/pdf/document";

/**
 * A member of staff's identity card, as a file.
 *
 * Same document, same refusal, **and no permission check of its own** — which
 * is the difference from the student route and worth reading twice.
 *
 * `getStaffCard` checks `staff.view` *inside itself* and returns null without
 * it, because RLS on `staff` is deliberately role-wide: admin, teacher,
 * accountant and librarian all read every row, so the policy narrows nothing
 * and the matrix is the only thing that expresses *"a librarian may not pull the
 * employment record"*. Rule 4's refinement — the check belongs in the function
 * that produces the data, not in each of its callers.
 *
 * So a second `hasPermission("staff.view")` here would be a copy of a check
 * that already ran, and a copy is where a rule quietly starts to differ from
 * itself. The **student** route checks, because `getIdCard` does not.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [result, t] = await Promise.all([getStaffCard(id), getT()]);

  if (!result) {
    return new Response("Not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const { card, school } = result;
  const photo = isPrintable(staffCardGaps(card, t)) ? await photoBytes(card.photoPath) : null;
  if (!photo) {
    return new Response(new UnfinishedCard(card.fullName).message, {
      status: 422,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const face = staffFace(card, t);

  try {
    const bytes = await renderIdCard({
      fullName: face.fullName,
      subtitle: face.subtitle,
      facts: face.facts,
      scanCode: face.scanCode,
      schoolName: school.name,
      sessionName: school.sessionName,
      photo,
    });

    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${idCardFileName(card.fullName)}"`,
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
