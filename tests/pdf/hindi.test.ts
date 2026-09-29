import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { devanagariFont, documentFont, scriptRuns, unrenderable, unrenderableMessage } from "@/lib/pdf/font";
import { Sheet } from "@/lib/pdf/document";
import { hi } from "@/lib/i18n/messages/hi";

/**
 * Hindi PDFs, pinned without a database.
 *
 * What went wrong on the way, and what these guard:
 *
 *   - pdf-lib's `drawText` with the Devanagari face renders shaped glyphs with
 *     gaps inside words and the `ि` matra standing apart from its consonant --
 *     seen by rendering the page, not by counting glyphs, which had said it
 *     was fine. So the renderer places each glyph itself, one text matrix
 *     per glyph, advance plus offset.
 *   - fontkit chooses its shaper from the first letter it meets, so a footer
 *     beginning "PS-001 · " shaped the Hindi after it as Latin and printed a
 *     bare halant. So text is shaped a script run at a time.
 *   - An English document must not start carrying a 220 kB face it never uses.
 */

const ROOT = process.cwd();

function streams(doc: PDFDocument): string {
  return doc
    .getPages()
    .map((page) => {
      const contents = page.node.Contents();
      const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
      return refs
        .map((ref) => {
          const stream = page.node.context.lookup(ref);
          if (!(stream instanceof PDFRawStream)) return "";
          const body = Buffer.from(stream.getContents());
          try {
            return inflateSync(body).toString("latin1");
          } catch {
            return body.toString("latin1");
          }
        })
        .join("");
    })
    .join("\n");
}

/** Every Hindi string in the catalogue, placeholders and all. */
const HINDI = Object.values(hi as Record<string, string>).filter((v) => /[ऀ-ॿ]/.test(v));

describe("Hindi in a PDF", () => {
  it("the Devanagari face covers every Hindi string the product has, with no .notdef", async () => {
    const font = await devanagariFont();
    expect(HINDI.length).toBeGreaterThan(500);
    for (const text of HINDI) {
      expect(unrenderable(text, font.covered), text).toEqual([]);
      expect(font.layout(text).glyphs.some((g) => g.id === 0), text).toBe(false);
    }
  });

  it("is shaped a script run at a time, so a line that starts in Latin still gets the Indic shaper", async () => {
    expect(scriptRuns("PS-001 · मार्च 2026")).toEqual([
      { text: "PS-001 · ", devanagari: false },
      { text: "मार्च 2026", devanagari: true },
    ]);
    expect(scriptRuns("कर्मचारी: Vivaan Verma")).toEqual([
      { text: "कर्मचारी: ", devanagari: true },
      { text: "Vivaan Verma", devanagari: false },
    ]);
    // Leading punctuation joins what follows rather than being a run of its own.
    expect(scriptRuns("(मार्च)")).toEqual([{ text: "(मार्च)", devanagari: true }]);
    // The reph: र् before च becomes one mark, not a bare halant, whichever way in.
    const font = await devanagariFont();
    const alone = font.layout("मार्च").glyphs.map((g) => g.id);
    const after = font.layout("PS-001 · मार्च").glyphs.map((g) => g.id);
    expect(after.slice(-alone.length)).toEqual(alone);
  });

  it("places each glyph at its advance plus its offset", async () => {
    const font = await devanagariFont();
    const run = font.layout("कृष्ण");
    // The ृ carries a real offset; this is the case drawText drops.
    expect(run.positions.some((p) => p.xOffset !== 0)).toBe(true);

    const sheet = await Sheet.create();
    sheet.text("कृष्ण", { size: 20 });
    const doc = await PDFDocument.load(await sheet.finish("x"));
    // The footer is Latin and drawn first by drawText (one Tm of its own); the
    // Devanagari runs are written after it, one Tm per glyph.
    const all = [...streams(doc).matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    expect(all.length).toBe(run.glyphs.length + 1);
    const xs = all.slice(1);
    let pen = 0;
    run.positions.forEach((p, i) => {
      expect(xs[i] - xs[0]).toBeCloseTo(((pen + p.xOffset) * 20) / font.unitsPerEm, 2);
      pen += p.xAdvance;
    });
  });

  it("an English document does not carry the Devanagari face; a Hindi one does", async () => {
    const english = await Sheet.create();
    english.text("Fee receipt — ₹1,234.00");
    const englishBytes = await english.finish("RC-2026-00001");

    const hindi = await Sheet.create();
    hindi.text("शुल्क रसीद — ₹1,234.00");
    const hindiBytes = await hindi.finish("RC-2026-00001");

    expect(englishBytes.length).toBeLessThan(20_000);
    expect(hindiBytes.length).toBeGreaterThan(60_000);
  });

  it("Urdu is still refused, and the sentence says which scripts are printed", async () => {
    const [{ covered: latin }, deva] = await Promise.all([documentFont(), devanagariFont()]);
    expect(unrenderable("یہ درست ہے", latin).length).toBeGreaterThan(0);
    expect(unrenderable("یہ درست ہے", deva.covered).length).toBeGreaterThan(0);
    expect(unrenderableMessage(["ی"])).toMatch(/Devanagari/);
    const sheet = await Sheet.create();
    expect(() => sheet.text("یہ درست ہے")).toThrow(/cannot be turned into a PDF/);
  });

  it("the licence travels with the face", () => {
    const licence = readFileSync(join(ROOT, "src/lib/pdf/fonts/OFL-NotoSansDevanagari.txt"), "utf8");
    expect(licence).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(licence).toMatch(/Noto Project Authors/);
  });
});
