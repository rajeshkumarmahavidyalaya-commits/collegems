import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { documentFont, unrenderable } from "./font";
import { UnrenderableDocument, pdfFileName } from "./document";
import { qrModules } from "@/lib/id-card/qr";

/**
 * An identity card, as a file.
 *
 * ## Why this is not `Sheet`
 *
 * `Sheet` is a document: A4, a measure, a cursor that flows top to bottom and
 * turns the page. A card has none of those. It is a fixed rectangle with things
 * placed on it — a photograph here, a name there — and forcing it through
 * `Sheet` would mean parameterising every one of `measure`, `wrap`, `turn`,
 * `signature` and `finish` to do nothing.
 *
 * What the two genuinely share is the font and the check that stops a blank
 * document, and both already live in `font.ts`.
 *
 * ## …and why the page is CR80 rather than A4
 *
 * 85.60 × 53.98 mm, the bank-card rectangle a school's laminating pouches and
 * badge holders are cut for. The **screen** prints eight-up on A4 for a
 * guillotine, and that is kept: the two are for different machines.
 *
 * > A sheet of eight is for a school with a guillotine and a laser printer. A
 * > file of CR80 pages is for a card printer, or for the print shop down the
 * > road — which is the one a school with four hundred children actually uses.
 *
 * ## The photograph is required, and that is the module's own rule
 *
 * `cardGaps()` has marked a missing photograph `blocking: true` since ID cards
 * shipped, under a comment saying *"a card with an empty square where the face
 * goes is not an identity card, it is a piece of paper with a name on it"*.
 * **Nothing enforced it** — `blocking` decided a CSS class and nothing else, so
 * the screen drew a dashed placeholder and printed anyway.
 *
 * A file is where that has to stop being a style: paper comes out of a machine
 * in a stack, and forty pieces of card stock with a dashed box on each is forty
 * pieces of card stock. So this refuses, in the same shape rule 12 gives
 * certificates — *a missing value stops the document; it is not smoothed over*.
 */

/** CR80 in PostScript points: 85.60 × 53.98 mm at 72dpi. */
export const CR80 = { width: 242.65, height: 153.02 } as const;

const PAD = 11;
const INK = rgb(0, 0, 0);
const QUIET = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.78, 0.78, 0.8);

/** The face, as `id-card.ts` builds it, plus the bytes of the photograph. */
export type CardDocument = {
  fullName: string;
  subtitle: string | null;
  facts: { label: string; value: string }[];
  /** What the code in the corner says; see `scan-code.ts`. */
  scanCode: string;
  schoolName: string;
  /** "2025-2026" — a card about *now* has to carry the now it was true of. */
  sessionName: string | null;
  photo: CardPhoto;
};

export type CardPhoto = { bytes: Uint8Array; contentType: string };

/**
 * Raised when a card cannot be drawn because there is no photograph.
 *
 * A class of its own rather than `UnrenderableDocument`, because the two are
 * different answers: one says *this build cannot draw your script*, the other
 * says *this card is not finished*. The first is a fact about the font and the
 * second is work for the office, and a route that collapsed them would tell
 * somebody to change their language when they need to take a photograph.
 */
export class UnfinishedCard extends Error {
  constructor(who: string) {
    super(
      `${who} has no photograph on file, so this cannot be printed as an ` +
        `identity card. Add one from their record and try again.`,
    );
    this.name = "UnfinishedCard";
  }
}

async function embedPhoto(doc: PDFDocument, photo: CardPhoto): Promise<PDFImage> {
  const type = photo.contentType.toLowerCase();
  if (type.includes("png")) return doc.embedPng(photo.bytes);
  if (type.includes("jpeg") || type.includes("jpg")) return doc.embedJpg(photo.bytes);
  // The `avatars` bucket also allows webp, which pdf-lib cannot embed. Said out
  // loud rather than drawn as a blank square — the whole point of this file.
  throw new UnfinishedCard(`A ${photo.contentType} photograph`);
}

/**
 * The dark modules of a QR code as PDF rectangles, runs merged along each row,
 * inside a square at (`x`, `y`) of side `size` with two modules of quiet zone.
 *
 * Its own function because it is the one place orientation can go wrong: PDF's
 * y runs **up** the page and the matrix's rows run **down** it, and a code
 * drawn upside down is a mirror image, which a standard decoder refuses.
 * `tests/id-card/scan-code.test.ts` rebuilds the matrix from these rectangles
 * and compares.
 */
export function qrRectangles(
  modules: boolean[][],
  x: number,
  y: number,
  size: number,
): { x: number; y: number; width: number; height: number }[] {
  const unit = size / (modules.length + 4);
  const out: { x: number; y: number; width: number; height: number }[] = [];
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      out.push({
        x: x + (start + 2) * unit,
        y: y + size - (r + 3) * unit,
        width: (c - start) * unit,
        height: unit,
      });
    }
  });
  return out;
}

/**
 * Draw one card onto a page.
 *
 * Everything is placed rather than flowed, and every string goes through the
 * font's coverage check first for the reason `Sheet` does: `drawText` maps a
 * glyph the font lacks to `.notdef` and draws **nothing**, so an unchecked card
 * is a blank rectangle with a school's name on it.
 */
function drawCard(
  page: PDFPage,
  font: PDFFont,
  covered: ReadonlySet<number>,
  doc: CardDocument,
  photo: PDFImage,
): void {
  const check = (text: string): string => {
    const missing = unrenderable(text, covered);
    if (missing.length > 0) throw new UnrenderableDocument(missing);
    return text;
  };
  const fit = (text: string, size: number, width: number): string => {
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let out = "";
    for (const ch of text) {
      if (font.widthOfTextAtSize(`${out}${ch}…`, size) > width) break;
      out += ch;
    }
    return `${out}…`;
  };
  const draw = (
    text: string,
    x: number,
    y: number,
    size: number,
    width: number,
    tone: "ink" | "quiet" = "ink",
  ): void => {
    page.drawText(fit(check(text), size, width), {
      x,
      y,
      size,
      font,
      color: tone === "quiet" ? QUIET : INK,
    });
  };

  const inner = CR80.width - PAD * 2;

  // The header strip: who issued this, and which year it is for. A document
  // about *now* must carry the now it was true of, or it is a card with no
  // expiry that a fifteen-year-old is still holding at twenty.
  const headerY = CR80.height - PAD - 7;
  const session = doc.sessionName ? `${doc.sessionName}` : "";
  const sessionWidth = session ? font.widthOfTextAtSize(session, 6) + 6 : 0;
  draw(doc.schoolName.toLocaleUpperCase("en"), PAD, headerY, 7.5, inner - sessionWidth);
  if (session) {
    draw(session, CR80.width - PAD - sessionWidth + 6, headerY, 6, sessionWidth, "quiet");
  }

  const ruleY = headerY - 5;
  page.drawLine({
    start: { x: PAD, y: ruleY },
    end: { x: CR80.width - PAD, y: ruleY },
    thickness: 0.5,
    color: RULE,
  });

  // The photograph, at 3:4 — the ratio every passport-style photo is cut to, so
  // a school's existing stack of them is not stretched.
  //
  // It runs nearly the full height of the card below the rule, which is what
  // the first draft got wrong: a 52 × 66 box left the bottom third of the card
  // empty and read as a card that had not finished printing. **On an identity
  // card the face is the document**; the text beside it is the caption.
  const photoW = 81;
  const photoH = 108;
  const photoX = PAD;
  const photoY = PAD + 3;
  page.drawImage(photo, { x: photoX, y: photoY, width: photoW, height: photoH });
  page.drawRectangle({
    x: photoX,
    y: photoY,
    width: photoW,
    height: photoH,
    borderColor: RULE,
    borderWidth: 0.5,
  });

  const textX = photoX + photoW + 9;
  const textW = CR80.width - PAD - textX;
  let y = photoY + photoH - 9;

  // The code, bottom corner. 44pt is 15.5mm: a 33-module code at ~0.42mm a
  // module, which a phone reads at a hand's length. Drawn as rectangles on a
  // white square carrying two modules of quiet zone, so a card printed on
  // coloured stock still scans. Text beside it narrows rather than running
  // underneath -- a code with a word through it is not a code.
  const qrSize = 44;
  const qrX = CR80.width - PAD - qrSize;
  const qrY = PAD;
  page.drawRectangle({ x: qrX, y: qrY, width: qrSize, height: qrSize, color: rgb(1, 1, 1) });
  for (const rect of qrRectangles(qrModules(doc.scanCode), qrX, qrY, qrSize)) {
    page.drawRectangle({ ...rect, color: INK });
  }
  const besideCode = (lineY: number) => (lineY < qrY + qrSize + 2 ? textW - qrSize - 6 : textW);

  draw(doc.fullName, textX, y, 10.5, textW);
  y -= 11;
  if (doc.subtitle) {
    draw(doc.subtitle, textX, y, 7, textW, "quiet");
    y -= 11;
  } else {
    y -= 3;
  }

  // The facts, each a small label over its value. Bounded by what fits: a card
  // that ran off the bottom would be worse than one that says less, and the
  // module already decides which facts matter most by putting them first.
  for (const fact of doc.facts) {
    if (y - 14 < PAD) break;
    draw(fact.label.toLocaleUpperCase("en"), textX, y, 5.5, besideCode(y), "quiet");
    y -= 7;
    draw(fact.value, textX, y, 7.5, besideCode(y));
    y -= 10;
  }
}

async function open(): Promise<{ doc: PDFDocument; font: PDFFont; covered: ReadonlySet<number> }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { bytes, covered } = await documentFont();
  const font = await doc.embedFont(bytes, { subset: true });
  return { doc, font, covered };
}

export async function renderIdCard(card: CardDocument): Promise<Uint8Array> {
  const { doc, font, covered } = await open();
  const photo = await embedPhoto(doc, card.photo);
  drawCard(doc.addPage([CR80.width, CR80.height]), font, covered, card, photo);
  return doc.save();
}

/**
 * A set, one card to a page.
 *
 * Same argument as the report card's: a school prints a class in one pass, and
 * forty downloads is forty chances to miss one. **Every card must be
 * printable** — a set that silently dropped the children with no photograph
 * would hand an office a stack of thirty-eight where they asked for forty, and
 * rule 13 already settled that shape: *refuse an oversized input rather than
 * truncating it*, because nobody notices until April.
 */
export async function renderIdCards(cards: CardDocument[]): Promise<Uint8Array> {
  const { doc, font, covered } = await open();
  for (const card of cards) {
    const photo = await embedPhoto(doc, card.photo);
    drawCard(doc.addPage([CR80.width, CR80.height]), font, covered, card, photo);
  }
  return doc.save();
}

/** `Aryan-Pandey-id-card.pdf`, or `Grade-4-A-id-cards.pdf` for a class. */
export function idCardFileName(stem: string, many = false): string {
  return pdfFileName(`${stem}-id-card${many ? "s" : ""}`);
}
