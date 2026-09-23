import type { MessageKey } from "@/lib/i18n/messages/en";
import { scanCodeFor } from "./scan-code";
import type { Translator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";
import type { SchoolIdentity } from "@/lib/school/identity";

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
  /**
   * The object path, for a renderer that needs the **bytes** rather than a link.
   *
   * A URL is for a browser; a PDF embeds the image and has none. Minting a
   * signed URL in order to fetch bytes the server could read directly is
   * signing something nobody asked for — rule 8's *"never render a signed link
   * into a page"* one step along — so the card carries both and each consumer
   * takes the one it can use.
   */
  photoPath: string | null;
};

/**
 * What the card face actually renders, for anybody the school issues one to.
 *
 * The face was student-shaped at first — `admissionNumber`, `className`,
 * `rollNumber`, `guardianName` — and staff cards would have meant either a
 * second component or a type where half the fields are always null. Neither
 * survives a third kind of card (a visitor pass, a temporary card for an
 * examiner), so the face takes a **heading, a subtitle and a list of labelled
 * facts** and each module decides what goes in them.
 *
 * The labels come in already resolved, which is deliberate: the face is a
 * Server Component and the module that builds a card already holds `t`.
 */
export type PersonCard = {
  id: string;
  fullName: string;
  /** The line under the name: a class and roll, or a designation and department. */
  subtitle: string | null;
  photoUrl: string | null;
  /** See `IdCard.photoPath`: the face draws the URL, the renderer needs bytes. */
  photoPath: string | null;
  facts: { label: string; value: string }[];
  /**
   * What the code on the card says -- `sos:student:<id>` -- which the scan
   * screen reads back and routes to the record page. See `scan-code.ts` for
   * why it is not a web address.
   */
  scanCode: string;
};

/**
 * Who the school is, re-exported from its reader.
 *
 * The type moved to `@/lib/school/identity` beside the single function that
 * resolves it — `school.profile` is not an ID-card concept, and the invoice
 * document and the certificate engine already read it in SQL. Re-exported here
 * so a card module has one import to remember.
 */
export type { SchoolIdentity };

/**
 * What a bulk run refuses with, shared by both card sheets.
 *
 * Rule 7's *"bound it and say the bound out loud"* has one shape, and two
 * unions spelling the same refusal is where they start to differ.
 */
export type TooMany = { ok: false; reason: "too-many"; count: number };

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

/** A student's card, as the face renders it. */
export function studentFace(
  card: IdCard,
  t: Translator,
  formatDate: (value: string, locale: Locale) => string,
  locale: Locale,
): PersonCard {
  const facts: { label: string; value: string }[] = [
    { label: t("idCard.admissionNumber"), value: card.admissionNumber },
  ];
  if (card.dateOfBirth) {
    facts.push({ label: t("idCard.dateOfBirth"), value: formatDate(card.dateOfBirth, locale) });
  }
  if (card.bloodGroup) facts.push({ label: t("idCard.bloodGroup"), value: card.bloodGroup });
  if (card.guardianName) {
    facts.push({
      label: t("idCard.guardian"),
      value: card.guardianPhone
        ? `${card.guardianName} · ${card.guardianPhone}`
        : card.guardianName,
    });
  }

  return {
    id: card.studentId,
    fullName: card.fullName,
    subtitle: card.className
      ? card.rollNumber
        ? `${card.className} · ${t("idCard.roll")} ${card.rollNumber}`
        : card.className
      : null,
    photoUrl: card.photoUrl,
    photoPath: card.photoPath,
    facts,
    scanCode: scanCodeFor("student", card.studentId),
  };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/**
 * A member of staff's card.
 *
 * Same document, different facts — and **a different authorization story**,
 * which is the part worth reading twice.
 *
 * A student card needs no gate beyond `students.view`, because RLS on
 * `students` is row-ownership: a class teacher printing "their" class gets
 * their own children and the policy is what decides that. RLS on `staff` is
 * **role-wide** — admin, teacher, accountant and librarian all read every row —
 * so the policy narrows nothing and *"an accountant may not pull the staff
 * roster"* is a rule only `role_permissions` expresses.
 *
 * That is rule 4's refinement exactly: the matrix does real work wherever RLS
 * is deliberately tenant-wide, and `staff_roster` already checks `staff.view`
 * *inside the function that produces the data*. This module reads `staff`
 * directly (it needs `photo_path`, which the roster does not return), so it
 * must make the same check itself rather than inherit it.
 */
export type StaffCard = {
  staffId: string;
  fullName: string;
  employeeCode: string;
  designation: string;
  department: string | null;
  phone: string | null;
  bloodGroup: string | null;
  photoUrl: string | null;
  photoPath: string | null;
};

export function staffFace(card: StaffCard, t: Translator): PersonCard {
  const facts: { label: string; value: string }[] = [
    { label: t("idCard.employeeCode"), value: card.employeeCode },
  ];
  if (card.phone) facts.push({ label: t("idCard.phone"), value: card.phone });
  if (card.bloodGroup) facts.push({ label: t("idCard.bloodGroup"), value: card.bloodGroup });

  return {
    id: card.staffId,
    fullName: card.fullName,
    subtitle: card.department ? `${card.designation} · ${card.department}` : card.designation,
    photoUrl: card.photoUrl,
    photoPath: card.photoPath,
    facts,
    scanCode: scanCodeFor("staff", card.staffId),
  };
}

const STAFF_GAPS: { field: keyof StaffCard; key: MessageKey; blocking: boolean }[] = [
  { field: "photoUrl", key: "idCard.gap.photo", blocking: true },
  { field: "phone", key: "idCard.gap.phone", blocking: false },
  { field: "department", key: "idCard.gap.department", blocking: false },
  { field: "bloodGroup", key: "idCard.gap.bloodGroup", blocking: false },
];

export function staffCardGaps(card: StaffCard, t: Translator): CardGap[] {
  return STAFF_GAPS.filter(({ field }) => !card[field]).map(({ field, key, blocking }) => ({
    field,
    message: t(key),
    blocking,
  }));
}

/**
 * Whether a card can be produced at all.
 *
 * `blocking` has been on the photograph gap since ID cards shipped, under a
 * comment saying *"a card with an empty square where the face goes is not an
 * identity card, it is a piece of paper with a name on it"*. **Nothing enforced
 * it**: `blocking` decided a CSS class and nothing else, so the screen drew a
 * dashed placeholder and printed anyway. That is this codebase's own recurring
 * defect — a column recording an intention with no executable half.
 *
 * One predicate, consulted by both halves, so they cannot disagree: the PDF
 * route refuses, and the pages do not offer a download that would refuse. *A
 * control that will refuse you is worse than no control*, because it costs the
 * person the work of trying.
 *
 * It deliberately does **not** stop the screen printing. Printing is the
 * school's own paper in the school's own tray and a half-finished card can be
 * looked at; a file is what leaves the building.
 */
export function isPrintable(gaps: CardGap[]): boolean {
  return !gaps.some((gap) => gap.blocking);
}

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
export function setSummary(cards: { photoUrl: string | null }[], t: Translator): string | null {
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
