import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { arabicFont, devanagariFont, documentFont, scriptRuns, unrenderable, unrenderableMessage } from "@/lib/pdf/font";
import { Sheet } from "@/lib/pdf/document";
import { hi } from "@/lib/i18n/messages/hi";
import { ur } from "@/lib/i18n/messages/ur";

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
const URDU = Object.values(ur as Record<string, string>).filter((v) => /[\u0600-\u06ff]/.test(v));

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

  it("a script no face covers is refused, and the sentence names the scripts that are printed", async () => {
    const [{ covered: latin }, deva, arab] = await Promise.all([documentFont(), devanagariFont(), arabicFont()]);
    for (const set of [latin, deva.covered, arab.covered]) {
      expect(unrenderable("தமிழ்", set).length).toBeGreaterThan(0);
    }
    expect(unrenderableMessage(["த"])).toMatch(/Devanagari \(Hindi\) and Arabic \(Urdu\)/);
    const sheet = await Sheet.create();
    expect(() => sheet.text("தமிழ்")).toThrow(/cannot be turned into a PDF/);
  });

  it("the Naskh face covers every Urdu string the product has, with no .notdef", async () => {
    const font = await arabicFont();
    expect(URDU.length).toBeGreaterThan(500);
    for (const text of URDU) {
      // The rupee sign is the one character Naskh lacks; the typesetter draws
      // it from Work Sans mid-line.
      expect(unrenderable(text.replace(/₹/g, ""), font.covered), text).toEqual([]);
      expect(font.layout(text, true).glyphs.some((g) => g.id === 0), text).toBe(false);
    }
  });
});

describe("Urdu in a PDF", () => {
  /** x of the first text matrix of each Span, in the order the stream writes them. */
  function spans(raw: string): { text: string; x: number }[] {
    const out: { text: string; x: number }[] = [];
    for (const m of raw.matchAll(/\/Span <<\s*\/ActualText <FEFF([0-9A-F]*)>\s*>> BDC[\s\S]*?1 0 0 1 ([\d.-]+) [\d.-]+ Tm/g)) {
      const hex = m[1];
      let text = "";
      for (let i = 0; i < hex.length; i += 4) text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      out.push({ text, x: Number(m[2]) });
    }
    return out;
  }

  it("carries the words it drew as ActualText, so copy and search read characters, not glyph ids", async () => {
    const sheet = await Sheet.create({ locale: "ur" });
    sheet.text("فیس بل");
    const raw = streams(await PDFDocument.load(await sheet.finish("x")));
    expect(spans(raw).map((s) => s.text)).toContain("فیس بل");
  });

  it("lays a mixed line out right to left: the Urdu word to the right of the Latin one", async () => {
    const sheet = await Sheet.create({ locale: "ur" });
    // Logical order: Urdu word, then a Latin number. On the page the Urdu is
    // rightmost, so its span starts further right than the Latin text.
    sheet.text("رسید RC-2026-00001");
    const raw = streams(await PDFDocument.load(await sheet.finish("x")));
    const urdu = spans(raw).find((s) => s.text.includes("رسید"))!;
    const latin = [...raw.matchAll(/1 0 0 1 ([\d.-]+) [\d.-]+ Tm\s*<[0-9A-F]+> Tj/g)].map((m) => Number(m[1]));
    expect(urdu).toBeDefined();
    expect(Math.min(...latin)).toBeLessThan(urdu.x);
  });

  it("mirrors a row: in Urdu the first cell is on the right", async () => {
    const at = async (locale: "en" | "ur") => {
      const sheet = await Sheet.create({ locale });
      sheet.row([{ text: "AAAA", width: 0.5 }, { text: "BBBB", width: 0.5 }]);
      const raw = streams(await PDFDocument.load(await sheet.finish("x")));
      return [...raw.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    };
    const [enFirst, enSecond] = await at("en");
    const [urFirst, urSecond] = await at("ur");
    expect(enFirst).toBeLessThan(enSecond);
    expect(urFirst).toBeGreaterThan(urSecond);
  });

  it("numbers its pages in the reader's language", async () => {
    const sheet = await Sheet.create({ locale: "ur" });
    for (let i = 0; i < 80; i++) sheet.text("سطر");
    const raw = streams(await PDFDocument.load(await sheet.finish("x")));
    expect(spans(raw).some((s) => s.text === "صفحہ 1 از 2" || s.text.includes("صفحہ"))).toBe(true);
  });

  it("an English document carries neither shaped face", async () => {
    const english = await Sheet.create();
    english.text("Fee receipt — ₹1,234.00");
    const raw = streams(await PDFDocument.load(await english.finish("RC-2026-00001")));
    expect(raw).not.toMatch(/ActualText/);
  });
});

describe("the licence", () => {
  it("travels with each face", () => {
    for (const file of ["OFL-NotoSansDevanagari.txt", "OFL-NotoNaskhArabic.txt"]) {
      const licence = readFileSync(join(ROOT, "src/lib/pdf/fonts", file), "utf8");
      expect(licence, file).toMatch(/SIL Open Font License, Version 1\.1/);
      expect(licence, file).toMatch(/Noto Project Authors/);
    }
  });
});
