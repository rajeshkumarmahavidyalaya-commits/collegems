import type { MessageKey } from "@/lib/i18n/messages/en";
import type { Translator } from "@/lib/i18n/translate";

/**
 * A student identity card.
 *
 * ## It is not frozen, and that is the whole design decision
 *
 * Rule 12 says *"anything printed on a document a person keeps is frozen when
 * the document is made"*, and gives report cards and certificates as the cases.
 * An ID card looks like a third and is not one:
 *
 * > A report card is a statement about **a term that has ended**. A certificate
 * > is a statement about **a day**. An identity card is a statement about
 * > **now** — and freezing it would print last year's class on the card a child
 * > is carrying this year.
 *
 * That is rule 4's second boundary asked of a document instead of a foreign key:
 * *is this child a statement about now, or a statement about a day that has
 * passed?* Substitutions freeze because they record a morning; this recomputes
 * because it records a fact that is still true.
 *
 * Three things follow, and they are why this module needs no migration at all:
 *
 * - **no serial.** `document_sequences` is for a gapless record — a certificate
 *   with a hole in its numbering is one nobody can audit. Reprinting a lost ID
 *   card is not an event anybody audits, and numbering it would make losing one
 *   a paperwork problem.
 * - **nothing stored.** No table, no `rules_snapshot`, no issued-on date.
 * - **it says which year it is for.** A document about *now* has to carry the
 *   *now* it was true of, or it is a card with no expiry that a fifteen-year-old
 *   is still holding at twenty. The session name is that, and it comes from
 *   `current_session_id()` server-side (rule 2) rather than from the caller.
 */
export type IdCard = {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  /** "Grade 6 · A", from this year's enrolment. Null when nobody has enrolled them. */
  className: string | null;
  rollNumber: string | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  address: string | null;
  /** A signed URL, issued at render and short-lived. Never a stored URL (rule 8). */
  photoUrl: string | null;
};

export type SchoolIdentity = {
  name: string;
  addressLine: string | null;
  phone: string | null;
  sessionName: string | null;
};

/**
 * What is blank on a card, as sentences.
 *
 * **Deliberately not a refusal**, which is where this parts company with
 * certificates. Rule 12 is emphatic that a certificate with a missing value must
 * not be issued — *"a certificate reading 'Father's Name: —' is a document a
 * school has to apologise for"* — because a leaving certificate is a legal
 * record and the blank is permanent.
 *
 * A card with no blood group is still a usable card. So this is the
 * `grading_scheme_problems()` shape instead: say what is missing, let the office
 * decide, and print. The one exception is the photograph, which is marked
 * `blocking` — a card with an empty square where the face goes is not an
 * identity card, it is a piece of paper with a name on it.
 *
 * Ordered worst first, so a person scanning a class of forty sees the card they
 * have to do something about at the top.
 */
export type CardGap = { field: string; message: string; blocking: boolean };

const GAPS: { field: keyof IdCard; key: MessageKey; blocking: boolean }[] = [
  { field: "photoUrl", key: "idCard.gap.photo", blocking: true },
  { field: "className", key: "idCard.gap.className", blocking: false },
  { field: "guardianPhone", key: "idCard.gap.guardianPhone", blocking: false },
  { field: "guardianName", key: "idCard.gap.guardianName", blocking: false },
  { field: "bloodGroup", key: "idCard.gap.bloodGroup", blocking: false },
  { field: "dateOfBirth", key: "idCard.gap.dateOfBirth", blocking: false },
];

export function cardGaps(card: IdCard, t: Translator): CardGap[] {
  return GAPS.filter(({ field }) => !card[field]).map(({ field, key, blocking }) => ({
    field,
    message: t(key),
    blocking,
  }));
}

/**
 * One sentence for a whole set, because forty cards with two gaps each is eighty
 * sentences and nobody reads eighty sentences before pressing print.
 *
 * Both counts are carried rather than a stem and a rule: rule 2's number
 * agreement lesson — *"put every count-dependent word in one place, and carry
 * both forms rather than a stem and a rule, because English plurals are not
 * derivable"*. `t.plural` does exactly that.
 */
export function setSummary(cards: IdCard[], t: Translator): string | null {
  const withoutPhoto = cards.filter((c) => !c.photoUrl).length;
  if (withoutPhoto === 0) return null;
  return t.plural("idCard.missingPhotos", withoutPhoto, { count: withoutPhoto });
}

/**
 * A CR80 card is 85.60 × 53.98 mm — the same rectangle as a bank card, which is
 * what a school's laminating pouches and badge holders are cut for. Printing at
 * any other ratio produces cards that do not fit the holders a school already
 * owns, which is the kind of thing nobody discovers until four hundred are cut.
 */
export const CARD_ASPECT = "85.6 / 54";

/** Eight to an A4 sheet in two columns, which is what a school's guillotine expects. */
export const CARDS_PER_SHEET = 8;

/**
 * Rule 7: bound it and say the bound out loud.
 *
 * A section is bounded by the size of a class, so this is generous rather than
 * load-bearing — but the page also renders one signed URL per card, and a
 * request that signs nine hundred objects is not a page, it is a job. Refused
 * with the number rather than truncated: a sheet holding the first hundred and
 * twenty of three hundred children looks complete, which is rule 13's lesson.
 */
export const MAX_CARDS_PER_RUN = 120;
