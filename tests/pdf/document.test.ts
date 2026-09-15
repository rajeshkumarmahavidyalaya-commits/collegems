import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { documentFont, unrenderable, unrenderableMessage } from "@/lib/pdf/font";
import { Sheet, UnrenderableDocument, pdfFileName } from "@/lib/pdf/document";
import { certificateFileName, renderCertificate } from "@/lib/pdf/certificate";
import { invoiceFileName, renderInvoice, type InvoiceStrings } from "@/lib/pdf/invoice";

/**
 * The PDF renderer, pinned without a database.
 *
 * Everything here runs against the real font file and the real library, because
 * the three things worth guarding are all facts about *those* rather than about
 * this code:
 *
 *   - a built-in PDF font cannot draw a rupee, so a money document is
 *     impossible without an embedded one;
 *   - `drawText` does **not** fail on a glyph the font lacks — it draws
 *     nothing — so the coverage check is the only thing between a school and a
 *     blank certificate;
 *   - the frozen row is the only input, because a PDF outlives the session it
 *     was made in.
 */

const ROOT = process.cwd();

/** The live row from the demo college, verbatim. */
const LIVE_BODY = `This is to certify that Vivaan Verma, son/daughter of Arjun Verma, Admission Number SOS-2025-0001, is a bona fide student of Rajesh Kumar Mahavidyalaya and is studying in Class Grade 1 A during the academic session 2025-2026.

This certificate is issued on request for a passport application.

Certificate No. CERT-2025-00001, issued on 10 September 2026.`;

function certificate(overrides: Partial<Parameters<typeof renderCertificate>[0]> = {}) {
  return {
    serialNo: "CERT-2025-00001",
    kind: "bonafide",
    kindLabel: "Bonafide certificate",
    issuedOn: "2026-09-10",
    body: LIVE_BODY,
    status: "issued",
    cancelReason: null,
    cancelledOn: null,
    snapshot: {
      "school.name": "Rajesh Kumar Mahavidyalaya",
      "school.address": "Ballia, Uttar Pradesh",
    } as Record<string, string | null>,
    ...overrides,
  };
}

describe("the document font", () => {
  it("covers every character this product actually emits", async () => {
    const { covered } = await documentFont();
    // The rupee is the reason a font is embedded at all: `StandardFonts`
    // are WinAnsi and `drawText("₹")` throws `WinAnsi cannot encode`.
    // The other four are what the English catalogue already contains.
    for (const ch of ["₹", "–", "—", "’", "…"]) {
      expect(unrenderable(ch, covered), `the document font must draw ${ch}`).toEqual([]);
    }
  });

  /**
   * The negative control, and it is the whole point of the check.
   *
   * pdf-lib maps a missing glyph to `.notdef` and draws nothing — a valid PDF,
   * no warning, and a document blank where the words were. If this ever passes
   * with an empty array, the renderer has started producing blank certificates
   * silently.
   */
  it("knows what it cannot draw", async () => {
    const { covered } = await documentFont();
    expect(unrenderable("यह सही है", covered).length).toBeGreaterThan(0);
    expect(unrenderable("یہ درست ہے", covered).length).toBeGreaterThan(0);
  });

  it("treats a line break as layout, not as a glyph", async () => {
    const { covered } = await documentFont();
    expect(unrenderable("one\ntwo\r\n\tthree", covered)).toEqual([]);
  });

  it("reports each missing character once, in the order it is met", async () => {
    const { covered } = await documentFont();
    expect(unrenderable("हरह", covered)).toEqual(["ह", "र"]);
  });

  /** A refusal that does not say which characters is a refusal nobody can act on. */
  it("names the characters and says what would work instead", () => {
    const message = unrenderableMessage(["ह"]);
    expect(message).toContain("ह");
    expect(message).toContain("glyph");
    expect(message).toMatch(/print/i);
  });

  /**
   * The font is a vendored file, so the licence has to travel with it — and a
   * web-font *subset* must never be swapped in to save bytes: fontsource's
   * `latin` slice has the em dash and no rupee, and its `latin-ext` slice has
   * the rupee and no em dash. Neither can render "Fee reminder — ₹1,234.00".
   */
  /**
   * The font path stays a literal, because Next's file tracer can follow
   * `readFile(join(process.cwd(), "<literal>"))` and cannot follow a computed
   * one. Measured: the tracer finds the `.ttf` unaided today, so
   * `outputFileTracingIncludes` in `next.config.ts` is a declaration of intent
   * rather than the thing that makes it work — **this** is what stops somebody
   * building the filename from a weight or a locale and discovering in
   * production that the font never shipped.
   */
  it("keeps the font path where the bundler can see it", () => {
    const source = readFileSync(join(ROOT, "src/lib/pdf/font.ts"), "utf8");
    expect(source).toMatch(/join\(\s*process\.cwd\(\)\s*,\s*"[^"$`]+\.ttf"\s*\)/);
    // No template literal and no concatenation in the path.
    expect(source).not.toMatch(/join\(\s*process\.cwd\(\)\s*,\s*`/);
  });

  it("ships its licence beside it", () => {
    const dir = join(ROOT, "src/lib/pdf/fonts");
    const files = readdirSync(dir);
    expect(files.some((f) => /OFL|LICEN[CS]E/i.test(f))).toBe(true);
    const ttf = files.filter((f) => f.endsWith(".ttf"));
    expect(ttf.length, "one weight, deliberately").toBe(1);
    // Comfortably over any web slice (16–80 kB) and under a CJK face.
    expect(statSync(join(dir, ttf[0])).size).toBeGreaterThan(100_000);
  });
});

describe("a rendered certificate", () => {
  it("is a PDF that parses back, from the live row", async () => {
    const bytes = await renderCertificate(certificate());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
    // Subsetting is what keeps this small; the font file is 189 kB.
    expect(bytes.length).toBeLessThan(40_000);
  });

  it("draws money, dashes and quotes that a built-in font cannot", async () => {
    const bytes = await renderCertificate(
      certificate({
        body: "Fees outstanding: ₹4,200.00 — see the bursar’s note…",
      }),
    );
    expect(bytes.length).toBeGreaterThan(1000);
  });

  /**
   * The refusal, end to end. Planted rather than pinned to a real row: the demo
   * college's one certificate is English, so a control taken from it would pass
   * for the wrong reason.
   */
  it("refuses a script it cannot draw instead of shipping a blank page", async () => {
    await expect(
      renderCertificate(certificate({ body: "यह प्रमाणित" })),
    ).rejects.toBeInstanceOf(UnrenderableDocument);
  });

  it("turns the page and numbers it only when there is a second one", async () => {
    const one = await PDFDocument.load(await renderCertificate(certificate()));
    expect(one.getPageCount()).toBe(1);

    const long = await renderCertificate(
      certificate({
        body: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}. ` + "The quick brown fox jumps over the lazy dog. ".repeat(4)).join("\n\n"),
      }),
    );
    expect((await PDFDocument.load(long)).getPageCount()).toBeGreaterThan(1);
  });

  /** A cancelled certificate keeps its serial and stays legible — see the renderer. */
  it("renders a cancelled certificate rather than withholding it", async () => {
    const bytes = await renderCertificate(
      certificate({
        status: "cancelled",
        cancelReason: "Issued against the wrong admission number",
        cancelledOn: "2026-09-12",
      }),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("survives a school with no address and no name on file", async () => {
    const bytes = await renderCertificate(certificate({ snapshot: {} }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("the filename", () => {
  /**
   * `Content-Disposition` is a header, so a value carrying a quote or a newline
   * ends it early. The serial comes from a database column, which is exactly
   * the storage module's `safeFileName()` hazard one layer along.
   */
  it("cannot end the header it is put in", () => {
    expect(pdfFileName('CERT"2025\r\nX')).not.toMatch(/["\r\n]/);
    expect(pdfFileName("../../etc/passwd")).not.toContain("/");
    expect(pdfFileName("")).toBe("document.pdf");
    expect(certificateFileName("CERT-2025-00001")).toBe("CERT-2025-00001.pdf");
  });
});

describe("what the renderer is not allowed to do", () => {
  const renderer = readFileSync(join(ROOT, "src/lib/pdf/certificate.ts"), "utf8");
  const code = renderer
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

  /**
   * Rule 12: *preview computes; issue freezes.* The page that shows a
   * certificate already refuses to look the student up; a **file** has to
   * refuse harder, because it outlives its session — two copies of one
   * certificate that disagree while both look authentic is the failure, and the
   * wrong one is whichever was produced later.
   */
  it("reads the frozen row and nothing else", () => {
    for (const forbidden of ["createClient", "supabase", "from(", "rpc(", "current_"]) {
      expect(code, `the certificate renderer must not reach for ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  /**
   * And the route says nothing about whether the row exists.
   *
   * Under RLS *"there is no such certificate"* and *"that one is not yours"* are
   * the same answer, so a 404 that claims absence is wrong half the time and
   * turns the route into an oracle for which serials exist.
   */
  it("does not tell a stranger whether a certificate exists", () => {
    const route = readFileSync(
      join(ROOT, "src/app/(app)/certificates/[id]/pdf/route.ts"),
      "utf8",
    );
    const body = route.slice(route.indexOf("export async function GET"));
    expect(body).toContain("status: 404");
    expect(body).not.toMatch(/not found|does not exist|no such/i);
  });
});

describe("the boundedness argument", () => {
  /**
   * Rule 7's test is boundedness, not category. "PDF rendering" sat on the
   * `jobs` list because the assumed mechanism was a headless browser; building
   * the document from the row that already holds it is not that.
   *
   * The bound is asserted loosely on purpose — CI machines vary and a timing
   * test that fails on a slow runner is a test people learn to ignore. What is
   * being guarded is the *order of magnitude*: if one certificate ever costs
   * seconds, somebody has put a browser behind this and it belongs in a queue.
   */
  it("renders one document in the time a query takes, not the time a browser takes", async () => {
    await renderCertificate(certificate()); // warm the font cache
    const started = Date.now();
    await renderCertificate(certificate());
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("the sheet", () => {
  it("breaks a word too long for the measure rather than losing the edge", async () => {
    const sheet = await Sheet.create();
    sheet.text("x".repeat(400), { size: 11 });
    const bytes = await sheet.finish("guard");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("checks the footer too, not only the body", async () => {
    const sheet = await Sheet.create();
    sheet.text("fine");
    await expect(sheet.finish("हर")).rejects.toBeInstanceOf(UnrenderableDocument);
  });
});

// ---------------------------------------------------------------------------
// The second document, which is what makes the first one a primitive
// ---------------------------------------------------------------------------

const STRINGS: InvoiceStrings = {
  method: (c) => (c === "upi" ? "UPI" : (c ?? "")),
  heading: "Fee invoice",
  billedTo: "Billed to",
  charges: "Charges",
  payments: "Payments received against this invoice",
  total: "Total charged",
  paid: "Paid",
  outstanding: "Outstanding",
  noPayments: "No payment has been credited against this invoice.",
  cancelled: "This invoice has been cancelled",
  producedOn: "Produced",
};

/** IN-2025-00001 from the demo college, to the rupee. */
function invoice(overrides: Partial<Parameters<typeof renderInvoice>[0]> = {}) {
  return {
    invoice: {
      number: "IN-2025-00001",
      issueDate: "2026-07-18",
      dueDate: "2026-08-17",
      status: "issued",
      notes: null,
      cancelReason: null,
    },
    school: {
      name: "Rajesh Kumar Mahavidyalaya",
      addressLine1: "Station Road",
      addressLine2: null,
      city: "Ballia",
      state: "Uttar Pradesh",
      postalCode: "277001",
      phone: "+91 98765 43210",
      email: "office@rkm.ac.in",
      website: null,
    },
    student: {
      fullName: "Vivaan Verma",
      admissionNumber: "SOS-2025-0001",
      sectionLabel: "Grade 1 \u00b7 A",
      rollNumber: "7",
      guardianName: "Arjun Verma",
    },
    lines: [
      { description: "Tuition fee", amount: 6900 },
      { description: "Transport fee", amount: 4800 },
      { description: "Examination fee", amount: 1200 },
      { description: "Activity fee", amount: 900 },
      { description: "Library fee", amount: 600 },
    ],
    payments: [
      {
        occurredAt: "2026-08-09",
        receiptNumber: "RC-2025-00084",
        method: "upi",
        amount: 14400,
        isReversal: false,
      },
    ],
    total: 14400,
    paid: 14400,
    outstanding: 0,
    sessionName: "2025-2026",
    ...overrides,
  };
}

describe("a rendered invoice", () => {
  it("is a bill that a built-in PDF font could not have drawn", async () => {
    // Every figure carries a rupee, and `StandardFonts.Helvetica` throws
    // `WinAnsi cannot encode "₹"`. This is the document that justifies the
    // embedded font, so the assertion is simply that it renders at all.
    const bytes = await renderInvoice(invoice(), "en", STRINGS);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders a bill with nothing paid against it", async () => {
    const bytes = await renderInvoice(
      invoice({ payments: [], paid: 0, outstanding: 14400 }),
      "en",
      STRINGS,
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders a cancelled bill rather than withholding it", async () => {
    const bytes = await renderInvoice(
      invoice({
        invoice: { ...invoice().invoice, status: "cancelled", cancelReason: "Raised twice" },
      }),
      "en",
      STRINGS,
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  /**
   * A description longer than its column is truncated, never allowed to run
   * into the figure beside it. A parent reading a number that belongs to the
   * line above is the failure this prevents.
   */
  it("keeps a long description out of the amount column", async () => {
    const bytes = await renderInvoice(
      invoice({
        lines: [{ description: "Transport fee ".repeat(30), amount: 4800 }],
      }),
      "en",
      STRINGS,
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("names the file after the invoice number", () => {
    expect(invoiceFileName("IN-2025-00001")).toBe("IN-2025-00001.pdf");
  });

  /**
   * The limitation, asserted rather than left to be discovered.
   *
   * `formatDate(d, "hi")` returns Devanagari month names, which the document
   * font has no glyphs for — so a Hindi reader is **refused with a sentence**
   * instead of handed a bill with blanks where its dates should be. If this
   * ever stops throwing, either the font gained Devanagari (good, and the
   * English-only `pdf.invoice.*` keys are then owed translations) or the
   * coverage check stopped working (bad, and a family is holding a blank).
   */
  it("refuses a locale the document font cannot draw, and says so", async () => {
    await expect(renderInvoice(invoice(), "hi", STRINGS)).rejects.toBeInstanceOf(
      UnrenderableDocument,
    );
  });
});

// ---------------------------------------------------------------------------
// …and none of it may reach a browser
// ---------------------------------------------------------------------------

describe("the renderer stays on the server", () => {
  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        sourceFiles(p, acc);
      } else if (/\.tsx?$/.test(entry.name)) {
        acc.push(p);
      }
    }
    return acc;
  }

  /**
   * pdf-lib is ~400 kB and belongs in no browser. Both PDF routes build to
   * **145 B / 103 kB** — the shared baseline and nothing else — and one
   * `"use client"` file importing `pdfFileName` for its filename helper would
   * quietly end that.
   *
   * `fees-display.ts`'s lesson, one library along: *one import and it silently
   * becomes the thing it was extracted from.* The guard is on the client
   * boundary rather than on a byte count, because a byte count only fails after
   * somebody has already shipped it.
   */
  it("is imported by no client component", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(ROOT, "src/app")), ...sourceFiles(join(ROOT, "src/components"))]) {
      const body = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(body);
      if (!isClient) continue;
      const stripped = body
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      if (/from\s+["'](@\/lib\/pdf|pdf-lib|@pdf-lib\/fontkit)/.test(stripped)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders, "pdf-lib is ~400 kB and must never reach a browser").toEqual([]);
  });
});
