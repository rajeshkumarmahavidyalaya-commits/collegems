import {
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFPage,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type Color,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as upstreamFontkit from "fontkit";
import {
  UnrenderableDocument,
  devanagariFont,
  documentFont,
  scriptRuns,
  unrenderable,
  type ShapingFont,
} from "./font";

/**
 * The fonts one PDF is drawn with, and the decision about which one draws a
 * string.
 *
 * **A string that Work Sans can draw is drawn in Work Sans**, exactly as every
 * document was before, so an English receipt is byte-for-byte the same kind of
 * file: one subset font, around 5 kB. A string it cannot draw is tried against
 * Noto Sans Devanagari, and only a string **neither** can draw is refused, with
 * the characters named.
 *
 * The choice is per string, never per character. A Hindi line with an English
 * name in it is one face; switching faces mid-line would put two baselines and
 * two x-heights side by side in a sentence.
 *
 * ## Why the Devanagari half does not use `drawText`
 *
 * pdf-lib shapes through fontkit and then places each glyph at the previous
 * one's advance, **ignoring the offsets** the font's positioning table gives
 * the marks. For Latin that is harmless. For Devanagari it moves the `े` matra
 * and the reph off the letters they belong to, in 171 of the 591 strings in
 * the Hindi catalogue. So this file lays out each run with upstream fontkit
 * and writes one text matrix per glyph: the advance, plus the offset.
 *
 * ## Why the Devanagari half is drawn at `finish()`
 *
 * Embedding a font is asynchronous and `Sheet`'s drawing is not. Rather than
 * embed the 220 kB face into every document in case one needs it, the runs are
 * measured now (upstream fontkit's layout is synchronous) and written when the
 * document is finished, which is also the only moment it is known whether any
 * were needed. The file of a document with no Devanagari does not carry the
 * face.
 */

/** One face: how wide a string is, and how to put it on a page. */
export type Face = {
  width(text: string, size: number): number;
  draw(page: PDFPage, text: string, at: { x: number; y: number; size: number; color: Color }): void;
};

type PendingRun = {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  size: number;
  color: Color;
};

export class Typeset {
  private readonly pending: PendingRun[] = [];
  readonly latin: Face;
  readonly devanagari: Face;

  private constructor(
    private readonly doc: PDFDocument,
    latinFont: PDFFont,
    private readonly latinCovered: ReadonlySet<number>,
    private readonly indic: ShapingFont,
  ) {
    this.latin = {
      width: (text, size) => latinFont.widthOfTextAtSize(text, size),
      draw: (page, text, { x, y, size, color }) =>
        page.drawText(text, { x, y, size, font: latinFont, color }),
    };
    this.devanagari = {
      width: (text, size) => {
        const run = indic.layout(text);
        let advance = 0;
        for (const p of run.positions) advance += p.xAdvance;
        return (advance * size) / indic.unitsPerEm;
      },
      draw: (page, text, at) => {
        this.pending.push({ page, text, ...at });
      },
    };
  }

  static async open(doc: PDFDocument): Promise<Typeset> {
    doc.registerFontkit(fontkit);
    const [{ bytes, covered }, indic] = await Promise.all([documentFont(), devanagariFont()]);
    const latin = await doc.embedFont(bytes, { subset: true });
    return new Typeset(doc, latin, covered, indic);
  }

  /**
   * The face that can draw all of `text`, or a refusal naming what neither
   * can. Called once per string on the way in, so a document is never half
   * drawn before it is refused.
   */
  pick(text: string): Face {
    if (unrenderable(text, this.latinCovered).length === 0) return this.latin;
    const missing = unrenderable(text, this.indic.covered);
    if (missing.length > 0) throw new UnrenderableDocument(missing);
    return this.devanagari;
  }

  /**
   * Write the Devanagari runs, if there were any. Must be awaited before
   * `doc.save()`; `Sheet.finish` and the card renderer both do.
   */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    // The embedder is created with whichever fontkit is registered at embed
    // time; Work Sans was embedded with @pdf-lib/fontkit above and keeps it.
    this.doc.registerFontkit(upstreamFontkit as unknown as Parameters<PDFDocument["registerFontkit"]>[0]);
    const font = await this.doc.embedFont(this.indic.bytes, { subset: false });
    const scale = 1 / this.indic.unitsPerEm;
    for (const run of this.pending.splice(0)) {
      // encodeText records the glyphs for the font's widths and its ToUnicode
      // map. Per script run, so pdf-lib's own shaping picks the same shaper
      // this file does.
      for (const part of scriptRuns(run.text)) font.encodeText(part.text);
      const key = run.page.node.newFontDictionary(font.name, font.ref);
      const shaped = this.indic.layout(run.text);
      const ops = [pushGraphicsState(), setFillingColor(run.color), beginText(), setFontAndSize(key, run.size)];
      let pen = 0;
      shaped.glyphs.forEach((glyph, i) => {
        const p = shaped.positions[i];
        const gx = run.x + (pen + p.xOffset) * scale * run.size;
        const gy = run.y + p.yOffset * scale * run.size;
        ops.push(setTextMatrix(1, 0, 0, 1, gx, gy));
        ops.push(showText(PDFHexString.of(glyph.id.toString(16).padStart(4, "0"))));
        pen += p.xAdvance;
      });
      ops.push(endText(), popGraphicsState());
      run.page.pushOperators(...ops);
    }
  }
}

/**
 * A string cut into what a reader sees as characters. `क्षि` is one of these
 * and four code points, and a line broken or an ellipsis placed between them
 * leaves a stray half-letter.
 */
export function graphemes(text: string): string[] {
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(seg.segment(text), (s) => s.segment);
}
