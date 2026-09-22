import { photoBytes } from "@/lib/storage/photos";
import { UnfinishedCard, type CardDocument, type CardPhoto } from "./card";

/**
 * Turning a set of faces into a set of printable cards, and the two ways that
 * fails.
 *
 * Shared by the student and staff bulk routes because the *choreography* is one
 * implementation — download each photograph, refuse the first person who has
 * none, and stop before the response grows past what a request should carry —
 * while the authorization is not. `getIdCards` is row-scoped through RLS;
 * `getStaffCards` checks `staff.view` inside itself. Rule 8's own split, one
 * layer up: share the ordering, keep the question apart.
 */

/**
 * How many bytes of photographs one file may carry.
 *
 * The `avatars` bucket admits objects up to 5 MB, so a class of forty could in
 * principle be 200 MB. The count bound (`MAX_CARDS_PER_RUN`) does not see that
 * at all — **a bound on rows is not a bound on bytes** — and this is the second
 * half of it.
 *
 * 24 MB is still a decision rather than a derivation — what a platform will
 * return is a fact about the deployment — but the **ratio** underneath it is
 * measured now, where it used to be assumed. Rendering a set of synthetic cards
 * around a 309,609-byte portrait: one card is 314,370 bytes, each further card
 * adds 310,089, and at forty the file is **1.0019×** the photographs it
 * carries. The font is embedded once and subset (4,761 bytes); the card itself
 * is 480.
 *
 * > **A bound on the photographs is, to within 0.2%, a bound on the response.**
 * > That is the step the ceiling rested on and nobody had checked.
 *
 * What is still unmeasured is a *real* photograph: this college has **0 objects
 * in Storage**, and a JPEG portrait is roughly a tenth of that PNG — so 24 MB
 * is ~77 cards of one kind and several hundred of the other. The refusal says
 * the number for exactly that reason, so the first school to meet it tells us
 * what the real one should be. See `docs/performance.md`.
 */
export const MAX_PHOTO_BYTES = 24 * 1024 * 1024;

export class CardSetTooLarge extends Error {
  constructor(done: number, total: number) {
    super(
      `These cards come to more than ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))} MB of ` +
        `photographs — ${done} of ${total} fitted. Print them in smaller groups.`,
    );
    this.name = "CardSetTooLarge";
  }
}

type Face = {
  fullName: string;
  subtitle: string | null;
  facts: { label: string; value: string }[];
  photoPath: string | null;
};

/**
 * Fetch every photograph and build the documents, or refuse.
 *
 * **Every card must be printable.** A set that silently dropped the children
 * with no photograph would hand an office a stack of thirty-eight where they
 * asked for forty — rule 13's *refuse an oversized input rather than truncating
 * it*, because nobody notices until April. So the first person without one
 * stops the whole file, by name.
 *
 * Sequential rather than parallel on purpose: the point is to stop at the byte
 * ceiling, and forty parallel downloads have all already happened by the time
 * the total is known.
 */
export async function cardDocuments(
  faces: Face[],
  school: { name: string; sessionName: string | null },
): Promise<CardDocument[]> {
  const docs: CardDocument[] = [];
  let bytes = 0;

  for (const face of faces) {
    const photo: CardPhoto | null = await photoBytes(face.photoPath);
    if (!photo) throw new UnfinishedCard(face.fullName);

    bytes += photo.bytes.byteLength;
    if (bytes > MAX_PHOTO_BYTES) throw new CardSetTooLarge(docs.length, faces.length);

    docs.push({
      fullName: face.fullName,
      subtitle: face.subtitle,
      facts: face.facts,
      schoolName: school.name,
      sessionName: school.sessionName,
      photo,
    });
  }

  return docs;
}
