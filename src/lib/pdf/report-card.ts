import { Sheet, pdfFileName } from "./document";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import type { Translator } from "@/lib/i18n/translator";
import {
  attendancePercent,
  attendanceSentence,
  paperMark,
  paperNote,
  rankSentence,
  type CardPaper,
  type ReportCard,
} from "@/lib/validations/report-cards";

/**
 * A report card, as a file.
 *
 * ## It renders the frozen row, exactly as the screen does
 *
 * The card arrives from `exams_report_cards` as one `jsonb` document, and for a
 * **published** exam every figure in it is read from `exam_results` — the
 * marks, the rank, the cohort size it was taken over, the `rules_snapshot` that
 * decided the scope, and (since `0080`) the attendance. Nothing here recomputes
 * any of it, and nothing here may: rule 12's whole argument is that a rank
 * cannot be worked out again later because *the cohort has changed*.
 *
 * That was checked rather than assumed. `0078` originally computed the
 * attendance line with a lateral call at read time — which is the defect rule
 * 12 describes, *"a reprint in December disagreed with the card handed out in
 * March"* — and `0080` is the migration that froze it onto the row. `0080` is
 * the latest definition, so the read path this renders is the fixed one.
 *
 * ## …and the warning moves onto the document
 *
 * A draft card renders too, because a class teacher checking the marks before
 * publication wants them on paper, and refusing would send them to a
 * screenshot. But the screen's banner — *"Do not hand this to a parent"* — is
 * addressed to **the person looking at the screen**, and a file has a different
 * reader: whoever it reaches, in a folder, a week later.
 *
 * > **The chrome is not the document.** A warning that lives in the interface
 * > around a file does not travel with it, so a provisional card says so at the
 * > top *and* in the footer of every page.
 *
 * `Sheet.finish` stamps the footer on every page after the last one is written,
 * which is what makes the second half possible at all.
 */

export type ReportCardDocument = {
  card: ReportCard;
  /** `resultLabel(...)`, resolved by the caller, which holds the translator. */
  resultLabel: string;
  /** `formatDate(published_at, locale)`, or null when it is not published. */
  publishedOn: string | null;
};

/**
 * What the file is called.
 *
 * The **child** first and the exam second, which is the opposite of a
 * certificate. A certificate is filed by its serial because that is what the
 * school's register is sorted on; a report card is opened by a parent who has
 * one child and several terms of them, so the name that disambiguates is the
 * exam.
 *
 * And a provisional card says so **in its name**, which the first cut of this
 * did not: rendering one produced a file called exactly what the published card
 * would be called, so a draft checked in August and the real card published in
 * September land in a folder as two identical names. The document's own footer
 * says `PROVISIONAL` on every page — but *"the chrome is not the document"*
 * cuts the other way here, because **the filename is the one piece of chrome
 * that travels with the file** and is the only part somebody reads before
 * opening it.
 */
export function reportCardFileName(card: ReportCard): string {
  const stem = `${card.student.name}-${card.exam.name}`;
  return pdfFileName(card.provisional ? `${stem}-provisional` : stem);
}

/** The subject table's columns, as fractions of the measure. They sum to 1. */
const SUBJECT = 0.42;
const FIGURE = 0.13;
const OUTCOME = 0.19;

function outcomeWord(paper: CardPaper, t: Translator): string {
  if (paper.absent) return t("reportCard.absent");
  return paper.passed ? t("reportCard.pass") : t("reportCard.fail");
}

/**
 * The working, under a paper that was marked in parts.
 *
 * *"Theory 55/70 · Practical 13/30"* — a parent looking at 68/100 with *Fail*
 * beside it is owed the sentence that explains it, and the sentence is the
 * practical mark. Frozen with the rest of the card, so it says what it said on
 * the day rather than what a later edit to the split would make it.
 */
function componentLine(paper: CardPaper): string | null {
  const parts = paper.components ?? [];
  if (parts.length === 0) return null;
  return parts
    .map((part) => {
      const got = part.absent ? "AB" : part.obtained === null ? "—" : Number(part.obtained);
      return `${part.name} ${got}/${Number(part.max)}`;
    })
    .join(" · ");
}

/**
 * A whole set in one file, one child to a sheet.
 *
 * **One PDF, not one per child**, because a school prints a class in a single
 * pass and twenty-five downloads is twenty-five chances to miss one. That is
 * also what makes `Sheet.newPage` worth having: *one child per sheet* is a
 * property of the document, and the bulk screen's `@media print` block already
 * says the same thing with `data-print="page"`.
 *
 * Bounded by the **section**, per rule 7, and the bound is the caller's: this
 * renders what it is given. Measured warm, one card repeated:
 *
 * | cards | bytes | total | each |
 * |---|---|---|---|
 * | 1 | 8,305 | 75 ms | 75.5 ms |
 * | 25 (a class) | 67,935 | **572 ms** | 22.9 ms |
 * | 40 | 105,001 | 750 ms | 18.7 ms |
 * | 301 (the school) | 753,606 | **5,450 ms** | 18.1 ms |
 *
 * > **The per-card cost falls by four times, and that is the finding.** The
 * > font is embedded **once per document**, not once per card, so a set is far
 * > cheaper than the same cards rendered one at a time. A first draft of this
 * > comment said *"66 ms each, so a class is about a second and a half"* —
 * > extrapolated from the single-card measurement and **three times too
 * > pessimistic.** A number you extrapolated is not a number you measured.
 *
 * It also re-prices the school-wide case honestly: `docs/modules/pdf.md` quotes
 * **10.4 s for 302 certificates**, which were 302 separate documents each
 * embedding the font. In one file it is 5.5 s — still far past a request, so it
 * stays queued work, but for a different reason than the one written down.
 */
export async function renderReportCards(
  docs: ReportCardDocument[],
  locale: Locale = DEFAULT_LOCALE,
): Promise<Uint8Array> {
  const sheet = await Sheet.create({ locale });
  const t = createTranslator(locale);
  docs.forEach((doc, i) => {
    if (i > 0) sheet.newPage();
    writeCard(sheet, doc, t);
  });
  return finishWith(sheet, docs[0], false, t);
}

export async function renderReportCard(
  doc: ReportCardDocument,
  locale: Locale = DEFAULT_LOCALE,
): Promise<Uint8Array> {
  const sheet = await Sheet.create({ locale });
  const t = createTranslator(locale);
  writeCard(sheet, doc, t);
  return finishWith(sheet, doc, true, t);
}

function writeCard(sheet: Sheet, doc: ReportCardDocument, t: Translator): void {
  const { card } = doc;
  const papers = card.papers ?? [];

  sheet.text(card.school.name, { size: 17, leading: 1.25, align: "center" });
  sheet.text(`${card.exam.name} · ${t("reportCard.session", { name: card.session.name })}`, {
    size: 9.5,
    leading: 1.35,
    align: "center",
    tone: "quiet",
    above: 4,
  });

  sheet.rule(16, 20);

  if (card.provisional) {
    // The certificate's CANCELLED block, doing the same job for the opposite
    // reason: that one says a document already handed over has been retracted,
    // this one says a document has not been handed over yet.
    sheet.text(t("reportCard.provisionalStamp"), { size: 12, align: "center" });
    sheet.text(
      t("reportCard.provisionalPdf"),
      { size: 9.5, leading: 1.45, align: "center", tone: "quiet", above: 4 },
    );
    sheet.rule(14, 18);
  }

  sheet.row([
    { text: t("reportCard.student"), width: 0.22 },
    { text: card.student.name, width: 0.78 },
  ]);
  if (card.student.section) {
    sheet.row([
      { text: t("reportCard.class"), width: 0.22 },
      { text: card.student.section, width: 0.78 },
    ]);
  }
  if (card.student.roll_number) {
    sheet.row([
      { text: t("reportCard.roll"), width: 0.22 },
      { text: card.student.roll_number, width: 0.78 },
    ]);
  }
  if (card.student.admission_number) {
    sheet.row([
      { text: t("reportCard.admission"), width: 0.22 },
      { text: card.student.admission_number, width: 0.78 },
    ]);
  }

  sheet.rule(16, 12);

  sheet.row(
    [
      { text: t("reportCard.subject"), width: SUBJECT },
      { text: t("reportCard.marks"), width: FIGURE, align: "end" },
      { text: t("reportCard.outOf"), width: FIGURE, align: "end" },
      { text: t("reportCard.passMark"), width: FIGURE, align: "end" },
      { text: t("reportCard.result"), width: OUTCOME, align: "end" },
    ],
    { size: 9, tone: "quiet" },
  );
  sheet.rule(6, 4);

  if (papers.length === 0) {
    sheet.text(t("reportCard.noPapers"), {
      size: 10,
      tone: "quiet",
      align: "center",
      above: 8,
    });
  }

  for (const paper of papers) {
    sheet.row([
      {
        text: paper.optional ? `${paper.subject} ${t("reportCard.additional")}` : paper.subject,
        width: SUBJECT,
      },
      { text: paperMark(paper), width: FIGURE, align: "end" },
      { text: String(Number(paper.max)), width: FIGURE, align: "end" },
      { text: String(Number(paper.pass)), width: FIGURE, align: "end" },
      // A word, never a colour: a card is photocopied in black and white more
      // often than it is read on a screen. Same decision the screen makes.
      { text: outcomeWord(paper, t), width: OUTCOME, align: "end" },
    ]);

    const parts = componentLine(paper);
    if (parts) sheet.row([{ text: parts, width: 1 }], { size: 8.5, leading: 1.3, tone: "quiet" });

    const note = paperNote(paper, t);
    if (note) sheet.row([{ text: note, width: 1 }], { size: 8.5, leading: 1.3, tone: "quiet" });
  }

  sheet.rule(12, 12);

  sheet.row([
    { text: t("reportCard.total"), width: 0.28 },
    { text: t("reportCard.totalValue", { obtained: Number(card.totals.obtained), max: Number(card.totals.max) }), width: 0.72 },
  ]);
  sheet.row([
    { text: t("reportCard.percentage"), width: 0.28 },
    { text: `${Number(card.totals.percentage).toFixed(1)}%`, width: 0.72 },
  ]);
  sheet.row([
    { text: t("reportCard.grade"), width: 0.28 },
    {
      text: card.totals.grade
        ? card.totals.grade_point !== null
          ? `${card.totals.grade} (${Number(card.totals.grade_point)})`
          : card.totals.grade
        : t("reportCard.notGraded"),
      width: 0.72,
    },
  ]);
  sheet.row([
    { text: t("reportCard.result"), width: 0.28 },
    { text: doc.resultLabel, width: 0.72 },
  ]);

  // "This school does not rank" rather than a blank, because several boards
  // have abolished class position outright and a blank reads as a number the
  // school failed to work out (rule 12).
  sheet.row([
    { text: t("reportCard.position"), width: 0.28 },
    { text: rankSentence(card.rank, t) ?? t("reportCard.noRank"), width: 0.72 },
  ]);

  const percent = attendancePercent(card.attendance);
  sheet.row([
    { text: t("reportCard.attendance"), width: 0.28 },
    {
      text:
        percent === null
          ? attendanceSentence(card.attendance, t)
          : `${attendanceSentence(card.attendance, t)} · ${t("reportCard.presentPercent", { percent })}`,
      width: 0.72,
    },
  ]);

  // Behaviour and skills (0303), in two columns: a trait and its letter.
  if (card.behaviour && card.behaviour.length > 0) {
    sheet.rule(14, 10);
    sheet.row([{ text: t("reportCard.behaviour"), width: 1 }], { size: 9, tone: "quiet" });
    const list = card.behaviour;
    for (let i = 0; i < list.length; i += 2) {
      const a = list[i];
      const b = list[i + 1];
      sheet.row(
        [
          { text: a.name, width: 0.4 },
          { text: a.grade, width: 0.1, align: "end" },
          { text: b ? b.name : "", width: 0.4 },
          { text: b ? b.grade : "", width: 0.1, align: "end" },
        ],
        { size: 10 },
      );
    }
    if (card.behaviour_legend) {
      sheet.text(card.behaviour_legend, { size: 8.5, tone: "quiet", above: 4 });
    }
  }

  if (card.remark) {
    sheet.rule(14, 10);
    sheet.row([{ text: t("reportCard.remark"), width: 1 }], { size: 9, tone: "quiet" });
    sheet.text(card.remark.text, { size: 10.5, leading: 1.5, above: 2 });
  }

  sheet.signature(card.student.class_teacher ?? t("reportCard.classTeacherSign"), "start");
}

/**
 * The footer, stamped on every page once the last one is written.
 *
 * Exported and pure, like `reportCardFileName`, because it is the half of the
 * provisional warning a test can actually read: a subset-embedded font draws
 * glyph ids rather than characters, so the rendered bytes cannot be searched
 * for the word.
 *
 * It identifies the document rather than describing it — a sheet separated from
 * the rest is otherwise anonymous — and carries the provisional warning, which
 * is the half a banner in the interface cannot do.
 *
 * **A set takes its footer from its first card**, which is right for the exam
 * and the publication state (one set is one exam) and deliberately drops the
 * child's name: a footer naming Aryan Pandey on twenty-five other children's
 * sheets is worse than no name at all.
 */
export function reportCardFooter(
  doc: ReportCardDocument | undefined,
  single: boolean,
  t: Translator = createTranslator(DEFAULT_LOCALE),
): string {
  if (!doc) return t("reportCard.setTitle");
  const { card } = doc;
  const stamp = card.provisional
    ? t("reportCard.footerProvisional")
    : doc.publishedOn
      ? t("reportCard.published", { date: doc.publishedOn })
      : t("reportCard.publishedBare");
  const identity = single ? `${card.student.name} · ${card.exam.name}` : card.exam.name;
  return `${identity} · ${stamp}`;
}

function finishWith(
  sheet: Sheet,
  doc: ReportCardDocument | undefined,
  single: boolean,
  t: Translator,
): Promise<Uint8Array> {
  return sheet.finish(reportCardFooter(doc, single, t));
}
