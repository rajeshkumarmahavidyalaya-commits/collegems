import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { documentFont, unrenderable, unrenderableMessage } from "./font";

/**
 * The layout primitive every PDF in this product is drawn with.
 *
 * ## Why this is not a browser
 *
 * "PDF rendering" sat on rule 7's `jobs` list for two hundred migrations, and
 * the reason was an assumption about the mechanism rather than a measurement:
 * *render the page to PDF* needs a headless browser, which is heavy, which is
 * queued work. **Building the document from the row that already holds it is
 * not that.** Measured on the live certificate, warm, six runs:
 *
 * | | |
 * |---|---|
 * | one certificate | **5,360 bytes, 57 ms** |
 * | 302 of them | **10.4 s** |
 *
 * So the boundedness rule decides it, exactly as it decided exports: one
 * document is an ordinary request answered as the person who asked, and a
 * whole school is queued work. No worker, no service identity, no second
 * authorization layer — RLS reads the row or it does not.
 *
 * ## …and it is not a screenshot either
 *
 * A PDF built here is a *document*: A4, real margins, text that reflows to the
 * measure. It is deliberately not a rendering of the web page, which already
 * has an answer — `window.print()` and the `@media print` block in
 * `globals.css`, which uses the reader's own system fonts and therefore prints
 * scripts this file's single embedded font cannot.
 *
 * Both are kept. They fail in opposite directions and a school needs both:
 * printing is for paper in their own tray; a file is for an attachment, a
 * phone, and anywhere there is no browser.
 */

/** A4 in PostScript points, which is the only unit a PDF has. */
export const A4 = { width: 595.28, height: 841.89 } as const;

/**
 * 56pt ≈ 19.8mm. Wide enough that a school can three-hole punch or bind a
 * certificate without eating a word, which is the only reason a document
 * margin is ever chosen.
 */
const MARGIN = 56;

const INK = rgb(0, 0, 0);
const QUIET = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0.8, 0.8, 0.82);

/** One cell of a table row. `width` is a fraction of the measure and they should sum to 1. */
export type Cell = {
  text: string;
  width: number;
  align?: "start" | "center" | "end";
};

export type RowOptions = {
  size?: number;
  leading?: number;
  tone?: "ink" | "quiet";
  above?: number;
};

export type TextOptions = {
  size?: number;
  /** Multiplied by `size`. 1.5 is the body default — a legal document is read slowly. */
  leading?: number;
  /** `quiet` is the muted grey the product uses for secondary text. */
  tone?: "ink" | "quiet";
  align?: "start" | "center" | "end";
  /** Extra space above this block, in points. */
  above?: number;
};

/**
 * A sheet being written down, top to bottom.
 *
 * It owns the cursor so a caller never computes a `y`, which is the whole
 * difference between a document that reflows and one that overlaps itself the
 * first time a school's name is long.
 */
export class Sheet {
  private page: PDFPage;
  private y: number;
  private readonly pages: PDFPage[] = [];

  private constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly covered: ReadonlySet<number>,
  ) {
    this.page = doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - MARGIN;
  }

  static async create(): Promise<Sheet> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const { bytes, covered } = await documentFont();
    const font = await doc.embedFont(bytes, { subset: true });
    return new Sheet(doc, font, covered);
  }

  /** The measure — how wide a line of this document is. */
  get measure(): number {
    return A4.width - MARGIN * 2;
  }

  /**
   * The check that stops a blank document, called once per string on the way
   * in. Throws rather than returning a result: every caller's correct response
   * is the same sentence, and a boolean here is a boolean somebody ignores.
   */
  private checked(text: string): string {
    const missing = unrenderable(text, this.covered);
    if (missing.length > 0) throw new UnrenderableDocument(missing);
    return text;
  }

  private widthOf(line: string, size: number): number {
    return this.font.widthOfTextAtSize(line, size);
  }

  /**
   * Greedy wrapping to the measure.
   *
   * A word longer than the measure — a URL, an admission number with no spaces
   * — is broken rather than allowed to run off the page, because a document
   * that loses its right-hand edge is worse than one with an ugly break.
   */
  private wrap(text: string, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph.trim() === "") {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line === "" ? word : `${line} ${word}`;
        if (this.widthOf(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line !== "") lines.push(line);
        if (this.widthOf(word, size) <= width) {
          line = word;
          continue;
        }
        let chunk = "";
        for (const ch of word) {
          if (this.widthOf(chunk + ch, size) > width && chunk !== "") {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Start a new page and put the cursor at the top of it. */
  private turn(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - MARGIN;
  }

  /** Write a block of text, wrapping and turning the page as needed. */
  text(raw: string, options: TextOptions = {}): this {
    const size = options.size ?? 10.5;
    const leading = size * (options.leading ?? 1.5);
    const color = options.tone === "quiet" ? QUIET : INK;
    const align = options.align ?? "start";

    this.y -= options.above ?? 0;

    for (const line of this.wrap(this.checked(raw), size, this.measure)) {
      // Leave room for the footer's rule and line.
      if (this.y - leading < MARGIN + 28) this.turn();
      this.y -= leading;
      if (line !== "") {
        const w = this.widthOf(line, size);
        const x =
          align === "center"
            ? MARGIN + (this.measure - w) / 2
            : align === "end"
              ? MARGIN + this.measure - w
              : MARGIN;
        this.page.drawText(line, { x, y: this.y, size, font: this.font, color });
      }
    }
    return this;
  }

  /**
   * One row of a table: cells laid across the measure at fixed widths.
   *
   * A bill is a table — description on the left, amount on the right, and the
   * amounts have to line up or nobody can add them up. Flowing that as text
   * would put a long fee-head description under its own figure.
   *
   * Widths are **fractions of the measure**, so the caller never touches
   * points. A cell whose text is too wide is truncated with an ellipsis rather
   * than allowed to run into its neighbour: a description that collides with a
   * figure is how a parent reads the wrong number.
   */
  row(cells: Cell[], options: RowOptions = {}): this {
    const size = options.size ?? 10;
    const leading = size * (options.leading ?? 1.6);
    const color = options.tone === "quiet" ? QUIET : INK;

    this.y -= options.above ?? 0;
    if (this.y - leading < MARGIN + 28) this.turn();
    this.y -= leading;

    let x = MARGIN;
    for (const cell of cells) {
      const width = this.measure * cell.width;
      const text = this.fit(this.checked(cell.text), size, width);
      const w = this.widthOf(text, size);
      const at =
        cell.align === "end" ? x + width - w : cell.align === "center" ? x + (width - w) / 2 : x;
      if (text !== "") {
        this.page.drawText(text, { x: at, y: this.y, size, font: this.font, color });
      }
      x += width;
    }
    return this;
  }

  /** Shorten to fit, with an ellipsis — the font is checked to have one. */
  private fit(text: string, size: number, width: number): string {
    if (this.widthOf(text, size) <= width) return text;
    let out = "";
    for (const ch of text) {
      if (this.widthOf(`${out}${ch}\u2026`, size) > width) break;
      out += ch;
    }
    return `${out}\u2026`;
  }

  /** A hairline across the measure. */
  rule(above = 10, below = 10): this {
    this.y -= above;
    if (this.y < MARGIN + 28) this.turn();
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + this.measure, y: this.y },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= below;
    return this;
  }

  /** Vertical space, in points. */
  space(points: number): this {
    this.y -= points;
    return this;
  }

  /**
   * A short signature rule with a caption under it.
   *
   * On the right by default, which is where an Indian school's principal signs
   * — and `start` exists because a countersigned document has two.
   *
   * **It sinks to the foot of the page rather than following the text**, and
   * that is the difference between a certificate and a fragment. A bonafide
   * certificate is four lines long; flowed, its signature sits a third of the
   * way down an otherwise empty A4 sheet, which reads as a document that was
   * cut off. A school signs at the bottom, so the block takes whichever
   * position is lower — the natural one, or just above the footer — and turns
   * the page when the text has already reached that far.
   */
  signature(caption: string, side: "start" | "end" = "end"): this {
    const width = 150;
    const FOOT = MARGIN + 110;
    const flowed = this.y - 56;
    if (flowed < FOOT + 24) {
      // The text runs to the foot already: give the signature its own page
      // rather than crowding it into the footer rule.
      this.turn();
      this.y = FOOT;
    } else {
      this.y = Math.min(flowed, FOOT);
    }
    const x = side === "end" ? MARGIN + this.measure - width : MARGIN;
    this.page.drawLine({
      start: { x, y: this.y },
      end: { x: x + width, y: this.y },
      thickness: 0.6,
      color: rgb(0.3, 0.3, 0.33),
    });
    this.y -= 13;
    const size = 9;
    const w = this.widthOf(this.checked(caption), size);
    this.page.drawText(caption, {
      x: x + (width - w) / 2,
      y: this.y,
      size,
      font: this.font,
      color: QUIET,
    });
    return this;
  }

  /**
   * Stamp every page's foot and return the bytes.
   *
   * The footer is written last, on purpose: *"Page 1 of 3"* is not knowable
   * while the document is still being written, and a document that says
   * *"Page 1 of 1"* on the first of three is the kind of small dishonesty
   * somebody notices and stops trusting the rest for.
   */
  async finish(footer: string): Promise<Uint8Array> {
    const size = 8;
    const total = this.pages.length;
    this.pages.forEach((page, i) => {
      const left = this.checked(footer);
      page.drawLine({
        start: { x: MARGIN, y: MARGIN + 18 },
        end: { x: MARGIN + this.measure, y: MARGIN + 18 },
        thickness: 0.5,
        color: RULE,
      });
      page.drawText(left, { x: MARGIN, y: MARGIN + 6, size, font: this.font, color: QUIET });
      if (total > 1) {
        const right = `Page ${i + 1} of ${total}`;
        page.drawText(right, {
          x: MARGIN + this.measure - this.widthOf(right, size),
          y: MARGIN + 6,
          size,
          font: this.font,
          color: QUIET,
        });
      }
    });
    return this.doc.save();
  }
}

/**
 * Raised when the document font has no glyph for something the document says.
 *
 * A named class rather than a plain `Error` because the route handler answers
 * it with 422 and the sentence, while anything else is a 500 — *this build
 * cannot print your script* and *something broke* are different answers and
 * only one of them tells the person what to do.
 */
export class UnrenderableDocument extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(unrenderableMessage(missing));
    this.name = "UnrenderableDocument";
    this.missing = missing;
  }
}

/**
 * A filename a browser will save without arguing.
 *
 * `Content-Disposition` is a header, so a serial number with a quote or a
 * newline in it would end the header early — the `safeFileName()` instinct
 * from the storage module, arriving where the text comes from a database
 * column rather than from an upload.
 */
export function pdfFileName(stem: string): string {
  const cleaned = stem
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${cleaned || "document"}.pdf`;
}
