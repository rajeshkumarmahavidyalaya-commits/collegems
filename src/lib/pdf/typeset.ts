import {
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  beginText,
  endMarkedContent,
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
import bidiFactory from "bidi-js";
import type { Direction } from "@/lib/i18n/config";
import {
  RTL_LETTER,
  UnrenderableDocument,
  arabicFont,
  devanagariFont,
  documentFont,
  unrenderable,
  type ShapingFont,
} from "./font";

/**
 * The fonts one PDF is drawn with, and the decision about which one draws
 * which part of a line.
 *
 * **A string that Work Sans can draw is drawn in Work Sans**, exactly as every
 * document was before, so an English receipt is the same kind of file: one
 * subset font, around 5 kB. A string it cannot draw is laid out in pieces:
 *
 * - **Hindi.** A string with no right-to-left letter that Noto Sans Devanagari
 *   covers is drawn wholly in it, so a Hindi line with an English name in it
 *   is one face rather than two x-heights side by side.
 * - **Urdu, and anything else.** The line is put through the Unicode bidi
 *   algorithm (`bidi-js`), cut into runs of one direction, and each run into
 *   pieces of one font: Noto Naskh Arabic first, then Work Sans, then Noto
 *   Devanagari. That is what lets `₹1,234.00` sit inside an Urdu line even
 *   though Naskh has no rupee sign.
 * - A character **no** face covers refuses the document, named.
 *
 * ## Why the shaped faces do not use `drawText`
 *
 * pdf-lib shapes through fontkit and then spaces the glyphs with its own width
 * table. Rendered and looked at, that left gaps inside Hindi words and stood
 * the `ि` matra apart from its consonant, and it drops the positioning offsets
 * the fonts give their marks: the `े` matra in 171 of 591 Hindi strings, and
 * every dot of Naskh, which draws the dots of ب ت ث as separate marks. So each
 * run is laid out with upstream fontkit and written with one text matrix per
 * glyph: the advance, plus the offset.
 *
 * ## Why copy and search still read the words
 *
 * A shaped run is glyph ids, and a conjunct or a joined Arabic letter is one
 * glyph standing for several characters, which pdf-lib's ToUnicode map cannot
 * describe. Each run is wrapped in a `/Span` with an `/ActualText` of the
 * characters it stands for, which is the PDF's own mechanism for exactly this.
 *
 * ## Why the shaped faces are written at `flush()`
 *
 * Embedding a font is asynchronous and `Sheet`'s drawing is not. Rather than
 * embed 200 kB faces into every document in case one needs them, the runs are
 * measured now (upstream fontkit's layout is synchronous) and written when the
 * document is finished, which is also the only moment it is known whether any
 * were needed. A document with no Hindi or Urdu does not carry either face.
 */

/** One way of drawing a string: how wide it is, and how to put it on a page. */
export type Face = {
  width(text: string, size: number): number;
  draw(page: PDFPage, text: string, at: { x: number; y: number; size: number; color: Color }): void;
};

type FontKey = "latin" | "deva" | "arab";

/** A piece of a line in one font and one direction, in visual order. */
type Piece = { font: FontKey; text: string; rtl: boolean };

type PendingRun = {
  page: PDFPage;
  font: "deva" | "arab";
  text: string;
  rtl: boolean;
  x: number;
  y: number;
  size: number;
  color: Color;
};

const bidi = bidiFactory();

export class Typeset {
  private readonly pending: PendingRun[] = [];
  readonly latin: Face;
  private readonly shaped: Record<"deva" | "arab", ShapingFont>;

  private constructor(
    private readonly doc: PDFDocument,
    private readonly latinFont: PDFFont,
    private readonly latinCovered: ReadonlySet<number>,
    deva: ShapingFont,
    arab: ShapingFont,
    /** The document's direction: the paragraph direction of an Urdu line. */
    readonly direction: Direction,
  ) {
    this.shaped = { deva, arab };
    this.latin = {
      width: (text, size) => latinFont.widthOfTextAtSize(text, size),
      draw: (page, text, { x, y, size, color }) => page.drawText(text, { x, y, size, font: latinFont, color }),
    };
  }

  static async open(doc: PDFDocument, options: { direction?: Direction } = {}): Promise<Typeset> {
    doc.registerFontkit(fontkit);
    const [{ bytes, covered }, deva, arab] = await Promise.all([documentFont(), devanagariFont(), arabicFont()]);
    const latin = await doc.embedFont(bytes, { subset: true });
    return new Typeset(doc, latin, covered, deva, arab, options.direction ?? "ltr");
  }

  private covers(font: FontKey, ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    return font === "latin" ? this.latinCovered.has(cp) : this.shaped[font].covered.has(cp);
  }

  /**
   * The face that draws all of `text`, or a refusal naming what no face can.
   * Called once per string on the way in, so a document is never half drawn
   * before it is refused.
   */
  pick(text: string): Face {
    if (unrenderable(text, this.latinCovered).length === 0) return this.latin;
    const missing = [...new Set(text)].filter(
      (ch) => ch !== "\n" && ch !== "\r" && ch !== "\t" && !(["latin", "deva", "arab"] as const).some((f) => this.covers(f, ch)),
    );
    if (missing.length > 0) throw new UnrenderableDocument(missing);
    return {
      width: (line, size) =>
        this.pieces(line).reduce((sum, piece) => sum + this.pieceWidth(piece, size), 0),
      draw: (page, line, at) => {
        let x = at.x;
        for (const piece of this.pieces(line)) {
          const w = this.pieceWidth(piece, at.size);
          if (piece.font === "latin") {
            page.drawText(piece.text, { x, y: at.y, size: at.size, font: this.latinFont, color: at.color });
          } else {
            this.pending.push({ page, font: piece.font, text: piece.text, rtl: piece.rtl, x, y: at.y, size: at.size, color: at.color });
          }
          x += w;
        }
      },
    };
  }

  private pieceWidth(piece: Piece, size: number): number {
    if (piece.font === "latin") return this.latinFont.widthOfTextAtSize(piece.text, size);
    const font = this.shaped[piece.font];
    let advance = 0;
    for (const p of font.layout(piece.text, piece.rtl).positions) advance += p.xAdvance;
    return (advance * size) / font.unitsPerEm;
  }

  /** `line` as pieces in visual order, left to right. */
  private pieces(line: string): Piece[] {
    if (!RTL_LETTER.test(line)) {
      // No right-to-left letter: one left-to-right paragraph, and Hindi wholly
      // in its own face where it can be.
      if (unrenderable(line, this.shaped.deva.covered).length === 0) return [{ font: "deva", text: line, rtl: false }];
      return this.byFont(line, false, ["latin", "deva", "arab"]);
    }
    const levels = bidi.getEmbeddingLevels(line, this.direction === "rtl" ? "rtl" : undefined);
    const mirrored = bidi.getMirroredCharactersMap(line, levels.levels);
    // Work in UTF-16 indices, which is what bidi-js reports.
    const units = line.split("");
    mirrored.forEach((ch, i) => {
      units[i] = ch;
    });
    const mirroredLine = units.join("");
    // Visual order of UTF-16 indices.
    const order = Array.from({ length: line.length }, (_, i) => i);
    for (const [start, end] of bidi.getReorderSegments(line, levels)) {
      const slice = order.slice(start, end + 1).reverse();
      order.splice(start, slice.length, ...slice);
    }
    // Level runs: logical stretches of one embedding level.
    const runOf = new Int32Array(line.length);
    for (let i = 1; i < line.length; i++) {
      runOf[i] = runOf[i - 1] + (levels.levels[i] !== levels.levels[i - 1] ? 1 : 0);
    }
    const out: Piece[] = [];
    let k = 0;
    while (k < order.length) {
      const run = runOf[order[k]];
      let lo = order[k];
      let hi = order[k];
      while (k < order.length && runOf[order[k]] === run) {
        lo = Math.min(lo, order[k]);
        hi = Math.max(hi, order[k]);
        k++;
      }
      const rtl = (levels.levels[lo] & 1) === 1;
      const text = mirroredLine.slice(lo, hi + 1);
      out.push(...this.byFont(text, rtl, rtl ? ["arab", "latin", "deva"] : ["latin", "arab", "deva"]));
    }
    return out;
  }

  /**
   * Cut one direction's run into pieces of one font, the first in `prefer`
   * that covers each character. A neutral (a space, a comma) stays with the
   * piece it is in rather than starting a new one. A right-to-left run's
   * pieces are returned right to left, which is left to right on the page.
   */
  private byFont(text: string, rtl: boolean, prefer: FontKey[]): Piece[] {
    const pieces: Piece[] = [];
    for (const ch of text) {
      const current = pieces[pieces.length - 1];
      if (current && this.covers(current.font, ch) && (/[\s\p{P}\p{S}\p{N}]/u.test(ch) || current.font === prefer.find((f) => this.covers(f, ch)))) {
        current.text += ch;
        continue;
      }
      const font = prefer.find((f) => this.covers(f, ch)) ?? prefer[0];
      pieces.push({ font, text: ch, rtl });
    }
    return rtl ? pieces.reverse() : pieces;
  }

  /**
   * Write the shaped runs, if there were any. Must be awaited before
   * `doc.save()`; `Sheet.finish` and the card renderer both do.
   */
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    // The embedder is created with whichever fontkit is registered at embed
    // time; Work Sans was embedded with @pdf-lib/fontkit above and keeps it.
    this.doc.registerFontkit(upstreamFontkit as unknown as Parameters<PDFDocument["registerFontkit"]>[0]);
    const embedded: Partial<Record<"deva" | "arab", PDFFont>> = {};
    for (const key of ["deva", "arab"] as const) {
      if (this.pending.some((r) => r.font === key)) {
        embedded[key] = await this.doc.embedFont(this.shaped[key].bytes, { subset: false });
      }
    }
    for (const run of this.pending.splice(0)) {
      const font = embedded[run.font]!;
      const shaping = this.shaped[run.font];
      const key = run.page.node.newFontDictionary(font.name, font.ref);
      const shaped = shaping.layout(run.text, run.rtl);
      registerGlyphs(font, shaped.glyphs);
      const scale = run.size / shaping.unitsPerEm;
      const ops: PDFOperator[] = [
        PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
          PDFName.of("Span"),
          // A PDFDict serialises as `<< … >>`, which is what BDC takes; pdf-lib's
          // argument type simply does not list it.
          this.doc.context.obj({ ActualText: PDFHexString.fromText(run.text) }) as unknown as PDFName,
        ]),
        pushGraphicsState(),
        setFillingColor(run.color),
        beginText(),
        setFontAndSize(key, run.size),
      ];
      let pen = 0;
      shaped.glyphs.forEach((glyph, i) => {
        const p = shaped.positions[i];
        ops.push(setTextMatrix(1, 0, 0, 1, run.x + (pen + p.xOffset) * scale, run.y + p.yOffset * scale));
        ops.push(showText(PDFHexString.of(glyph.id.toString(16).padStart(4, "0"))));
        pen += p.xAdvance;
      });
      ops.push(endText(), popGraphicsState(), endMarkedContent());
      run.page.pushOperators(...ops);
    }
  }
}

type ShapedGlyph = { id: number; codePoints?: number[]; advanceWidth?: number };

/**
 * Tell the embedded font about the glyphs this file actually drew.
 *
 * With `subset: false`, pdf-lib builds the font's width table and its
 * ToUnicode map from one glyph per code point: the nominal forms. A joined
 * Arabic letter (`uni066E.init`) or a Devanagari conjunct (`uni0915094D0937`)
 * is a different glyph, absent from both, so a viewer had no width for it and
 * no characters to copy. Measured with pdf.js: the Urdu bill extracted with no
 * Urdu in it at all.
 *
 * This reaches the embedder's glyph list, which is pdf-lib's internal, and
 * that is a deliberate exception to `font.ts`'s rule about private fields: the
 * rule is about a **safety check**, where silently losing the field ships a
 * blank page, and this is copy and search, where losing it degrades to the
 * ActualText span beside it. So it is guarded, and it does nothing if the shape
 * is not what it expects. A glyph with no code points (Naskh draws the dots of
 * ب ت ث as separate glyphs) is left out rather than mapped to nothing.
 */
function registerGlyphs(font: PDFFont, glyphs: ShapedGlyph[]): void {
  const cache = (font as unknown as { embedder?: { glyphCache?: { access?: () => unknown } } }).embedder
    ?.glyphCache?.access?.();
  if (!Array.isArray(cache)) return;
  const list = cache as ShapedGlyph[];
  const known = new Set(list.map((g) => g.id));
  let added = false;
  for (const glyph of glyphs) {
    if (known.has(glyph.id) || !glyph.codePoints || glyph.codePoints.length === 0) continue;
    list.push(glyph);
    known.add(glyph.id);
    added = true;
  }
  // The width table is written in runs of consecutive ids, so the list must
  // stay sorted.
  if (added) list.sort((x, y) => x.id - y.id);
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
