import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";

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
 * ## What it would take to print Hindi
 *
 * Written down because the next person will ask, and because two of the three
 * obstacles are library bugs rather than design decisions. Measured, all three:
 *
 *   - `@pdf-lib/fontkit` (the companion package pdf-lib's own documentation
 *     tells you to install) **throws `ReferenceError: regeneratorRuntime is not
 *     defined`** the instant its Indic syllable state machine runs. Its UMD
 *     bundle ships a Babel-transpiled generator without the polyfill. Latin
 *     text never reaches that code path, so the bug is invisible until
 *     somebody's Hindi certificate.
 *   - Upstream `fontkit` shapes the same word correctly — `हिन्दी` is 6
 *     codepoints and 5 glyphs, `क्ष` is 3 and 1, no `.notdef` — but pdf-lib's
 *     embedder calls a subsetting API it no longer has, so `subset: true`
 *     throws `_this.subset.encodeStream is not a function`.
 *   - `registerFontkit(upstreamFontkit)` with **`subset: false`** works end to
 *     end: 69,639 bytes, 486 ms, correctly shaped. The one combination that
 *     works is the one nobody would pick — the other package, with the option
 *     you would turn *on* to save bytes turned off.
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
    `This document cannot be turned into a PDF: the document font has no ` +
    `${missing.length === 1 ? "glyph" : "glyphs"} for ${shown}${more}. ` +
    `PDFs are produced in Latin script only — printing the page from your ` +
    `browser uses your own system fonts and will render it correctly.`
  );
}
