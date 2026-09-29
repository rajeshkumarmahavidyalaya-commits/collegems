import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import * as upstreamFontkit from "fontkit";

/**
 * The one font a document is drawn with, and the check that stops it lying.
 *
 * ## Why a font file at all
 *
 * A PDF's fourteen built-in fonts are encoded in WinAnsi, which has no rupee
 * sign. Measured: `drawText("₹1,234.00")` with `StandardFonts.Helvetica`
 * throws `WinAnsi cannot encode "₹" (0x20b9)` — so **every money document in
 * this product is impossible with a built-in font**, before any question about
 * Hindi arises. (The four typographic characters the English catalogue does
 * contain — `–` `—` `’` `…` — are all *inside* WinAnsi. That was worth
 * measuring rather than assuming: the reason to embed a font is the rupee, not
 * the dashes.)
 *
 * ## …and why the check below is the load-bearing half
 *
 * `drawText` does **not** fail on a character the embedded font lacks. It maps
 * it to `.notdef` and draws nothing. Measured against this very file's font:
 *
 * | text | glyphs | `.notdef` |
 * |---|---|---|
 * | `Vivaan` | 6 | 0 |
 * | `₹` | 1 | 0 |
 * | `हर माह` | 6 | **5** |
 *
 * A valid PDF, no warning, and a leaving certificate that is blank where the
 * words were. That is this codebase's oldest recurring defect — *a plausible
 * result rather than an error* — arriving in a document a family keeps, so the
 * renderer asks the font what it can draw **before** drawing and refuses with
 * the characters named.
 *
 * ## How Hindi is printed (and why it took three libraries' worth of care)
 *
 * Written down because every step below was measured, and two of the
 * obstacles are library bugs rather than design decisions:
 *
 *   - `@pdf-lib/fontkit` (the companion package pdf-lib's own documentation
 *     tells you to install) **throws `ReferenceError: regeneratorRuntime is not
 *     defined`** the instant its Indic syllable state machine runs. Its UMD
 *     bundle ships a Babel-transpiled generator without the polyfill. Latin
 *     text never reaches that code path, so the bug is invisible until
 *     somebody's Hindi certificate. It stays for Work Sans, which is Latin only.
 *   - Upstream `fontkit` shapes the same word correctly — `हिन्दी` is 6
 *     codepoints and 5 glyphs, `क्ष` is 3 and 1, no `.notdef` — but pdf-lib's
 *     embedder calls a subsetting API it no longer has, so `subset: true`
 *     throws `_this.subset.encodeStream is not a function`. With
 *     **`subset: false`** it embeds: the whole Devanagari face, ~90 kB
 *     compressed, paid only by a document that contains Devanagari.
 *   - **And pdf-lib then draws the glyphs at their advances and ignores their
 *     GPOS offsets.** The shaping is right and the placement is not: a vowel
 *     sign that the font positions against its consonant lands where the
 *     previous glyph ended. Measured over the Hindi catalogue, **171 of 591
 *     strings** carry a non-zero offset, the `े` matra alone in 98 of them.
 *     So `typeset.ts` lays the glyphs out itself, from upstream fontkit's
 *     positions, one text matrix per glyph.
 *
 * Urdu stays refused. It is Arabic script, right to left and joined, which is
 * a second font and a bidi pass — and a Latin-only file would print it
 * back to front, which is worse than the sentence below.
 *
 * And a fourth obstacle that is nobody's bug: **a web-font subset is cut for a
 * browser, which can load two files and fall back between them. A PDF embeds
 * one font and has no fallback.** `@fontsource/fira-sans`'s `latin` slice has
 * the em dash and no rupee; its `latin-ext` slice has the rupee and no em dash.
 * Neither can render *"Fee reminder — ₹1,234.00"*. So the file below is a
 * complete font, not a web slice.
 */

/**
 * Work Sans, because it covers every character this product emits and is
 * closest to the product's own Fira Sans among the complete faces available.
 * OFL, and the licence travels with it in this directory.
 *
 * One weight, deliberately. Hierarchy in these documents is size, space and
 * rules; a bold face would double what every PDF carries to save one heading a
 * few grams of ink.
 */
const FONT_FILE = join(process.cwd(), "src/lib/pdf/fonts/WorkSans-Regular.ttf");

/**
 * Noto Sans Devanagari, for any string Work Sans cannot draw. It also covers
 * Latin, digits, the rupee and the dashes, so a Hindi line with a child's name
 * in English is one face rather than two. OFL, licence beside it. A literal,
 * like the one above, so the file tracer can follow it.
 */
const DEVANAGARI_FILE = join(process.cwd(), "src/lib/pdf/fonts/NotoSansDevanagari-Regular.ttf");

export type DocumentFont = {
  bytes: Uint8Array;
  /** Every code point the file actually has a glyph for. */
  covered: ReadonlySet<number>;
};

let cached: DocumentFont | null = null;

/**
 * The font, read and parsed once per process. 189 kB on disk; `subset: true`
 * at embed time keeps the PDF itself around 5 kB.
 *
 * `covered` is read from the font file through fontkit's own public
 * `characterSet`, **not** from pdf-lib's embedder. Reaching into
 * `font.embedder.font` would work today and is an internal: a renderer whose
 * safety check is a private field is a renderer whose safety check disappears
 * on a patch release, silently, which is the exact failure this check exists
 * to prevent.
 */
export async function documentFont(): Promise<DocumentFont> {
  if (!cached) {
    const bytes = new Uint8Array(await readFile(FONT_FILE));
    const parsed = fontkit.create(bytes) as unknown as { characterSet: number[] };
    cached = { bytes, covered: new Set(parsed.characterSet) };
  }
  return cached;
}

/** A shaped glyph run from upstream fontkit: ids, and where each one goes. */
export type ShapedRun = {
  glyphs: { id: number }[];
  positions: { xAdvance: number; xOffset: number; yOffset: number }[];
};

export type ShapingFont = DocumentFont & {
  unitsPerEm: number;
  layout(text: string): ShapedRun;
};

let devanagari: ShapingFont | null = null;

/**
 * The Devanagari face, parsed once per process with **upstream** fontkit,
 * because that is the one whose Indic shaper runs (see above). Its `layout` is
 * what `typeset.ts` places glyph by glyph.
 */
export async function devanagariFont(): Promise<ShapingFont> {
  if (!devanagari) {
    const bytes = new Uint8Array(await readFile(DEVANAGARI_FILE));
    const parsed = upstreamFontkit.create(Buffer.from(bytes)) as unknown as {
      characterSet: number[];
      unitsPerEm: number;
      layout(text: string, features?: unknown, script?: string): ShapedRun;
    };
    devanagari = {
      bytes,
      covered: new Set(parsed.characterSet),
      unitsPerEm: parsed.unitsPerEm,
      // Shaped a script run at a time, with the script named: fontkit picks
      // its shaper from the *first* letter it meets, so "PS-001 · मार्च" left
      // to itself is shaped as Latin and prints मार्‌च with a bare halant.
      layout: (text) => {
        const out: ShapedRun = { glyphs: [], positions: [] };
        for (const run of scriptRuns(text)) {
          const shaped = parsed.layout(run.text, undefined, run.devanagari ? "deva" : "latn");
          out.glyphs.push(...shaped.glyphs);
          out.positions.push(...shaped.positions);
        }
        return out;
      },
    };
  }
  return devanagari;
}

const isDevanagari = (cp: number) => (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff);
/** A letter of some other script: Latin, mostly. Digits, spaces and punctuation are neither. */
const isOtherLetter = (ch: string) => /\p{L}|\p{M}/u.test(ch) && !isDevanagari(ch.codePointAt(0)!);

/**
 * `text` cut where it changes between Devanagari and another script. Spaces,
 * digits and punctuation belong to whichever run they are in, so a sentence
 * is one run and only a Latin *word* inside it is a second — which is how a
 * shaper expects to be fed.
 */
export function scriptRuns(text: string): { text: string; devanagari: boolean }[] {
  const runs: { text: string; devanagari: boolean }[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const kind = isDevanagari(cp) ? true : isOtherLetter(ch) ? false : null;
    const last = runs[runs.length - 1];
    if (last && (kind === null || kind === last.devanagari)) last.text += ch;
    else runs.push({ text: ch, devanagari: kind ?? false });
  }
  // A run of only punctuation at the start takes the script of what follows.
  if (runs.length > 1 && !/\p{L}/u.test(runs[0].text)) {
    runs[1].text = runs[0].text + runs[1].text;
    runs.shift();
  }
  return runs;
}

/**
 * Characters in `text` that the document font cannot draw, in the order a
 * person would find them, each appearing once.
 *
 * Deliberately **not** a boolean. A refusal that says *"this cannot be rendered"*
 * leaves somebody staring at a certificate they wrote themselves; naming the
 * characters says which words to change, and — the case this actually exists
 * for — makes *"the whole document is in a script this build cannot print"*
 * legible at a glance rather than as a blank page.
 *
 * The caller passes the font's own coverage, because reading the font is an
 * async filesystem call and this runs per string.
 */
export function unrenderable(text: string, covered: ReadonlySet<number>): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  // Iterate by code point, not by UTF-16 unit: an emoji or any astral character
  // is one glyph to a font and two units to `for (const c of "…")`'s predecessor.
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || seen.has(ch)) continue;
    // A line break is layout, never a glyph, and the tab likewise.
    if (ch === "\n" || ch === "\r" || ch === "\t") continue;
    if (!covered.has(cp)) {
      seen.add(ch);
      missing.push(ch);
    }
  }
  return missing;
}

/**
 * The sentence shown when a document cannot be drawn.
 *
 * Says the characters and says what is true about the build, because
 * *"unsupported character"* invites somebody to retype the same word.
 */
export function unrenderableMessage(missing: string[]): string {
  const shown = missing.slice(0, 12).map((c) => `“${c}”`).join(", ");
  const more = missing.length > 12 ? ` and ${missing.length - 12} more` : "";
  return (
    `This document cannot be turned into a PDF: the document fonts have no ` +
    `${missing.length === 1 ? "glyph" : "glyphs"} for ${shown}${more}. ` +
    `PDFs are produced in Latin and Devanagari (Hindi) script — printing the ` +
    `page from your browser uses your own system fonts and will render it correctly.`
  );
}

/**
 * Raised when neither document font has a glyph for something the document
 * says.
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
