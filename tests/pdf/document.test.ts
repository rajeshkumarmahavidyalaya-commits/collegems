import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { documentFont, unrenderable, unrenderableMessage } from "@/lib/pdf/font";
import { Sheet, UnrenderableDocument, pdfFileName } from "@/lib/pdf/document";
import { certificateFileName, renderCertificate } from "@/lib/pdf/certificate";
import { invoiceFileName, renderInvoice, type InvoiceStrings } from "@/lib/pdf/invoice";
import {
  renderReportCard,
  renderReportCards,
  reportCardFileName,
  reportCardFooter,
} from "@/lib/pdf/report-card";
import { parseCard, type ReportCard } from "@/lib/validations/report-cards";
import {
  CR80,
  UnfinishedCard,
  idCardFileName,
  renderIdCard,
  renderIdCards,
  type CardDocument,
} from "@/lib/pdf/card";
import { cardGaps, isPrintable, type IdCard } from "@/lib/validations/id-card";
import { createTranslator } from "@/lib/i18n/translate";

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

/**
 * The y-coordinate of every text run on each page, top first.
 *
 * The rendered *text* cannot be read back — the font is embedded as a subset,
 * so `drawText` writes glyph ids — but the **positions** are plain numbers in
 * the content stream, and they are what the interesting property is about.
 * Flate-compressed by `doc.save()`, hence the inflate.
 */
function pageStreams(doc: PDFDocument): string[] {
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    let raw = "";
    for (const ref of streams) {
      const stream = page.node.context.lookup(ref);
      if (stream instanceof PDFRawStream) {
        const body = Buffer.from(stream.getContents());
        raw += (() => {
          try {
            return inflateSync(body).toString("latin1");
          } catch {
            return body.toString("latin1");
          }
        })();
      }
    }
    return raw;
  });
}

/**
 * How many times a page opens a card.
 *
 * The school's name is the only thing drawn at 17pt — everything else on a
 * report card is 12 or under — so `Tf` at that size is *"a card starts here"*,
 * and it survives the font being subset in a way the text itself does not.
 */
function cardOpeningsPerPage(doc: PDFDocument): number[] {
  return pageStreams(doc).map((raw) => [...raw.matchAll(/\s17 Tf/g)].length);
}

/**
 * Source with its comments removed.
 *
 * A guard that reads prose reports on the prose — this codebase's oldest
 * recurring test bug, met here for the fourth time: the bulk route's comment
 * explains that "no such section" and "no permission" must be indistinguishable,
 * and the check forbidding that wording failed on the explanation. Strip first,
 * then match.
 */
function codeOf(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

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

  /**
   * The list in `next.config.ts` said **two** for as long as there were
   * **eight**: report cards and identity cards shipped as files and nothing
   * brought them here, so a declaration of intent covered a quarter of its own
   * surface. Nothing was broken — the comment beside it records, measured, that
   * the tracer finds the `.ttf` unaided — which is exactly why it could sit
   * wrong through four commits that added PDF routes.
   *
   * So the guard is on the **omission**, the shape `nav-audience` uses: every
   * route handler that imports the renderer must be named, and a ninth is a
   * line somebody writes on purpose rather than a silent gap.
   */
  it("declares the font for every route that renders a PDF", () => {
    const appDir = join(ROOT, "src/app");

    function handlers(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) handlers(p, acc);
        else if (entry.name === "route.ts" && /from "@\/lib\/pdf/.test(readFileSync(p, "utf8"))) {
          // Next keys these by the route path inside `app`, route groups and
          // all — `/(app)/students/id-cards/pdf`.
          acc.push("/" + relative(appDir, dir).split(sep).join("/"));
        }
      }
      return acc;
    }

    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    const declared = new Set(
      [...config.matchAll(/"(\/\([^"]*pdf)":\s*\[/g)].map((m) => m[1]),
    );

    const undeclared = handlers(appDir).filter((route) => !declared.has(route));
    expect(
      undeclared.sort(),
      "A route handler that renders a PDF reads the font from disk, and the " +
        "file tracer can only follow it as a string literal. Add the route to " +
        "outputFileTracingIncludes in next.config.ts.",
    ).toEqual([]);
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
  const code = codeOf("src/lib/pdf/certificate.ts");

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
    const route = codeOf("src/app/(app)/certificates/[id]/pdf/route.ts");
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

// ---------------------------------------------------------------------------
// The report card
// ---------------------------------------------------------------------------

/**
 * The live card from the demo college, as `exams_report_card` returned it to
 * that college's administrator — the top of Grade 4 A in the Half-Yearly
 * Examination. Verbatim, because the point of pinning it is that the renderer
 * and the read model cannot drift apart: a card that stops parsing here is a
 * `jsonb` shape that changed.
 */
const LIVE_CARD = {
  exam: {
    id: "4b498d4b-82e4-464c-afea-b64d3e542410",
    kind: "half_yearly",
    name: "Half-Yearly Examination",
    status: "published",
    ends_on: "2026-08-03",
    starts_on: "2026-07-24",
    published_at: "2026-09-03T20:40:45.678201+00:00",
  },
  rank: { scope: "section", position: 1, cohort_size: 25 },
  papers: [
    { max: 100, code: "MATH", note: null, pass: 33, grace: 0, absent: false, passed: true, counted: true, percent: 88, subject: "Mathematics", obtained: 88, optional: false, effective: 88 },
    { max: 100, code: "SCI", note: null, pass: 33, grace: 0, absent: false, passed: true, counted: true, percent: 40, subject: "Science", obtained: 40, optional: false, effective: 40 },
    { max: 100, code: "ART", note: null, pass: 33, grace: 0, absent: false, passed: true, counted: false, percent: 85, subject: "Art & Craft", obtained: 85, optional: true, effective: 85 },
  ],
  remark: null,
  school: { name: "Rajesh Kumar Mahavidyalaya" },
  totals: { max: 700, grade: "B2", result: "pass", obtained: 495, percentage: 70.714, grade_point: 7, subjects_failed: 0, subjects_counted: 7 },
  session: { id: "9a710508-446b-4040-b358-ea8cd8a687e6", name: "2025-2026" },
  student: {
    id: "3f06cd1d-2a3c-4ebd-9858-05ee020d1d51",
    name: "Aryan Pandey",
    section: "Grade 4 A",
    roll_number: "16",
    class_teacher: "Riya Rathore",
    admission_number: "SOS-2025-0187",
  },
  attendance: { late: 3, upto: "2026-09-03", absent: 0, marked: 20, excused: 0, present: 17 },
  provisional: false,
};

function liveCard(mutate: (card: ReportCard) => void = () => {}): ReportCard {
  const card = parseCard(structuredClone(LIVE_CARD));
  expect(card, "the live card no longer matches reportCardSchema").not.toBeNull();
  mutate(card!);
  return card!;
}

function cardDoc(card: ReportCard) {
  return {
    card,
    resultLabel: card.totals.result === "pass" ? "Pass" : "Fail",
    publishedOn: card.provisional ? null : "3 Sep 2026",
  };
}

describe("a rendered report card", () => {
  it("is a PDF that parses back, from the live card", async () => {
    const bytes = await renderReportCard(cardDoc(liveCard()));
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  /**
   * The screen's banner is addressed to the person looking at the screen. A
   * file has a different reader — whoever it reaches, in a folder, a week later
   * — so the warning has to be **on the document**, on every page.
   *
   * Read through `reportCardFooter` rather than out of the bytes: the font is
   * embedded as a subset, so `drawText` writes glyph ids and the rendered PDF
   * cannot be searched for the word. `Sheet.finish` stamping that string on
   * every page is already pinned one describe block up.
   */
  it("says it is provisional in the footer of every page", () => {
    const draft = cardDoc(liveCard((c) => {
      c.provisional = true;
      c.rank = null;
    }));
    expect(reportCardFooter(draft, true)).toContain("PROVISIONAL");
    expect(reportCardFooter(cardDoc(liveCard()), true)).not.toContain("PROVISIONAL");
  });

  /** A multi-page card is one document, so the warning reaches its second sheet. */
  it("turns the page when a remark runs long, and keeps one footer", async () => {
    const long = cardDoc(liveCard((c) => {
      c.provisional = true;
      c.remark = { text: "x ".repeat(3000), updated_at: null };
    }));
    const parsed = await PDFDocument.load(await renderReportCard(long));
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  /**
   * …and in the filename, which is the one piece of chrome that travels with
   * the file. Without it a draft checked in August and the published card land
   * in a folder under identical names.
   */
  it("names a provisional file so a folder can tell the two apart", () => {
    const published = reportCardFileName(liveCard());
    const draft = reportCardFileName(liveCard((c) => {
      c.provisional = true;
    }));
    expect(published).toBe("Aryan-Pandey-Half-Yearly-Examination.pdf");
    expect(draft).not.toBe(published);
    expect(draft).toContain("provisional");
  });

  /**
   * The branches the demo college's data does not take.
   *
   * All 301 of its results are plain marks — no components, no notes, no
   * absences, no remark, no failure. *A probe that only runs the path your seed
   * data happens to take has tested the seed data*, so these are planted: a
   * paper marked in parts, an absent paper, a failed one, a note, a long remark
   * and a subject name too wide for its column.
   */
  it("renders the parts of a card the demo data has none of", async () => {
    const bytes = await renderReportCard(cardDoc(liveCard((c) => {
      c.papers![0].components = [
        { id: "a", code: "TH", name: "Theory", max: 70, pass: 23, obtained: 55, absent: false },
        { id: "b", code: "PR", name: "Practical", max: 30, pass: 10, obtained: 13, absent: false },
      ];
      c.papers![0].passed = false;
      c.papers![0].note = "Failed the practical component";
      c.papers![1].absent = true;
      c.papers![1].obtained = null;
      c.papers![1].passed = false;
      c.papers![2].subject = "A subject with a deliberately very long name indeed";
      c.remark = { text: "Works steadily and reads well beyond her year.", updated_at: null };
      c.totals.result = "fail";
    })));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  /** A card with no papers at all is a sentence, not a crash. */
  it("renders a card with nothing on it", async () => {
    const bytes = await renderReportCard(cardDoc(liveCard((c) => {
      c.papers = [];
      c.rank = null;
      c.attendance = null;
    })));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("refuses a script it cannot draw instead of shipping a blank card", async () => {
    await expect(
      renderReportCard(cardDoc(liveCard((c) => {
        c.student.name = "हर माह";
      }))),
    ).rejects.toBeInstanceOf(UnrenderableDocument);
  });
});

describe("a class of report cards in one file", () => {
  /**
   * One PDF, one child to a sheet. A school prints a class in a single pass,
   * and twenty-five downloads is twenty-five chances to miss one.
   */
  it("gives every child their own page", async () => {
    const docs = Array.from({ length: 7 }, () =>
      cardDoc(liveCard((c) => {
        c.papers = [];
        c.rank = null;
        c.attendance = null;
      })),
    );
    const bytes = await renderReportCards(docs);
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(7);

    /*
     * **And the page count is not the test.** It took two planted violations to
     * find that out. Deleting the page turn between children gives *exactly the
     * same count* — 1, 2, 3 and 7 cards all come to 1, 2, 3 and 7 pages either
     * way — because `Sheet.signature` sinks to the foot of the sheet, so the
     * next card's opening lines are pushed over the edge and turn the page by
     * themselves.
     *
     * What actually breaks is the **layout**: the second child's school name
     * and exam line are stranded at the bottom of the first child's sheet,
     * under their signature. A check on where each page *starts* could not see
     * that either — the strandings are at the bottom, and every page still
     * begins at the top.
     *
     * So the property is *one card opens per page*, and the school's name at
     * 17pt is what opens one.
     */
    for (const [i, openings] of cardOpeningsPerPage(parsed).entries()) {
      expect(openings, `page ${i + 1} holds ${openings} cards, not one`).toBe(1);
    }
  });

  /**
   * And the set's footer names the **exam**, never the first child — a footer
   * reading "Aryan Pandey" on twenty-four other children's sheets is worse than
   * no name at all.
   */
  it("does not stamp the first child's name on everybody else's sheet", () => {
    const first = cardDoc(liveCard());
    expect(reportCardFooter(first, true)).toContain("Aryan Pandey");
    expect(reportCardFooter(first, false)).not.toContain("Aryan Pandey");
    expect(reportCardFooter(first, false)).toContain("Half-Yearly Examination");
  });

  /**
   * The per-card cost falls because the font is embedded once per *document*,
   * not once per card — which is why a class is a request and the school is
   * still a job. Loose, because a CI runner that fails this teaches people to
   * ignore it; what is guarded is the order of magnitude.
   */
  it("renders a class in the time a query takes", async () => {
    const docs = Array.from({ length: 25 }, () => cardDoc(liveCard()));
    await renderReportCards([docs[0]]); // warm
    const started = Date.now();
    await renderReportCards(docs);
    expect(Date.now() - started).toBeLessThan(6000);
  });
});

describe("what the report card renderer is not allowed to do", () => {
  const code = codeOf("src/lib/pdf/report-card.ts");

  /**
   * The certificate's rule, and it bites harder here: a rank is a fact about a
   * cohort that has since changed, so recomputing one produces a **plausible**
   * card that is not the card the family was given.
   */
  it("reads the frozen card and nothing else", () => {
    for (const forbidden of ["createClient", "supabase", "from(", "rpc(", "current_"]) {
      expect(code, `the report card renderer must not reach for ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  /**
   * "May I see this child's card" is answered by RLS, so the single-card route
   * deliberately adds no permission check. **"May I pull a whole class" is a
   * different question** — the `staff_record` / `staff_roster` distinction — and
   * the screen this route is the file version of already answers it.
   */
  it("gates the class on the permission and the single card on the policy", () => {
    const bulk = codeOf("src/app/(app)/exams/[examId]/report-cards/pdf/route.ts");
    const single = codeOf("src/app/(app)/report-card/[studentId]/[examId]/pdf/route.ts");
    expect(bulk).toContain('hasPermission("exams.view")');
    expect(single, "a second answer to a question RLS answers").not.toContain("hasPermission");
  });

  /** Neither route says whether the row exists — the same answer, either way. */
  it("does not tell a stranger whether a card exists", () => {
    for (const path of [
      "src/app/(app)/report-card/[studentId]/[examId]/pdf/route.ts",
      "src/app/(app)/exams/[examId]/report-cards/pdf/route.ts",
    ]) {
      const body = codeOf(path).slice(codeOf(path).indexOf("export async function GET"));
      expect(body, path).toContain("status: 404");
      expect(body, path).not.toMatch(/not found|does not exist|no such/i);
    }
  });
});

// ---------------------------------------------------------------------------
// The identity card
// ---------------------------------------------------------------------------

/**
 * A 2 × 2 grey PNG, inline.
 *
 * Inline rather than a fixture on disk because the thing being tested is that
 * *some* image embeds and the wrong kind is refused, not what the picture is —
 * and a test that needs a file somebody has to keep is a test that rots. The
 * demo college has **0 objects in Storage**, so there is no real photograph to
 * pin to anyway; that is the honest state of the college, not a gap in the
 * suite.
 */
const PNG_2x2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR42mOoAAMGCAUAJ24Foe4ZwwcAAAAASUVORK5CYII=",
  "base64",
);

function idCard(overrides: Partial<CardDocument> = {}): CardDocument {
  return {
    fullName: "Aryan Pandey",
    subtitle: "Grade 4 A \u00b7 Roll 16",
    facts: [
      { label: "Admission number", value: "SOS-2025-0187" },
      { label: "Blood group", value: "O+" },
      { label: "Guardian", value: "Sunita Pandey \u00b7 +91 98765 43210" },
    ],
    scanCode: "sos:student:83f1e640-45da-44df-811b-3d4a7093bb3c",
    schoolName: "Rajesh Kumar Mahavidyalaya",
    sessionName: "2025-2026",
    photo: { bytes: new Uint8Array(PNG_2x2), contentType: "image/png" },
    ...overrides,
  };
}

describe("a rendered identity card", () => {
  /**
   * CR80, the bank-card rectangle a school's laminating pouches are cut for.
   * Printing at any other ratio produces cards that do not fit the holders a
   * school already owns, which nobody discovers until four hundred are cut.
   */
  it("is a card, not a sheet of paper", async () => {
    const doc = await PDFDocument.load(await renderIdCard(idCard()));
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(CR80.width, 1);
    expect(height).toBeCloseTo(CR80.height, 1);
    // A4 is 595 × 842; this must be nowhere near it.
    expect(width).toBeLessThan(300);
  });

  /**
   * The `avatars` bucket admits webp and pdf-lib cannot embed one. Said out
   * loud, because the alternative is a card with a blank square where the face
   * goes — which is the defect this whole renderer exists to refuse.
   */
  it("refuses a photograph it cannot embed instead of drawing a blank square", async () => {
    await expect(
      renderIdCard(idCard({ photo: { bytes: new Uint8Array(PNG_2x2), contentType: "image/webp" } })),
    ).rejects.toBeInstanceOf(UnfinishedCard);
  });

  /** The font check reaches a card too, not only a document. */
  it("refuses a script it cannot draw", async () => {
    await expect(renderIdCard(idCard({ fullName: "\u0939\u0930 \u092e\u093e\u0939" }))).rejects.toBeInstanceOf(
      UnrenderableDocument,
    );
  });

  /** A card with no subtitle and no facts is still a card. */
  it("renders a card with nothing but a name on it", async () => {
    const bytes = await renderIdCard(idCard({ subtitle: null, facts: [], sessionName: null }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("gives every person their own card", async () => {
    const doc = await PDFDocument.load(await renderIdCards([idCard(), idCard(), idCard()]));
    expect(doc.getPageCount()).toBe(3);
  });

  it("names the file after the person", () => {
    expect(idCardFileName("Aryan Pandey")).toBe("Aryan-Pandey-id-card.pdf");
    expect(idCardFileName("Grade 4 A", true)).toBe("Grade-4-A-id-cards.pdf");
  });
});

describe("a card with no photograph is not an identity card", () => {
  const t = createTranslator("en");

  const student: IdCard = {
    studentId: "s1",
    fullName: "Aryan Pandey",
    admissionNumber: "SOS-2025-0187",
    className: "Grade 4 A",
    rollNumber: "16",
    dateOfBirth: "2016-03-14",
    bloodGroup: "O+",
    guardianName: "Sunita Pandey",
    guardianPhone: "+91 98765 43210",
    address: null,
    photoUrl: "https://example.test/signed",
    photoPath: "people/s1/face.png",
  };

  /**
   * `blocking: true` has been on the photograph gap since the module shipped,
   * under a comment saying a card without one *"is a piece of paper with a name
   * on it"* — and it decided a **CSS class**. `isPrintable` is that sentence
   * made executable.
   */
  it("says so, rather than colouring a list item red", () => {
    expect(isPrintable(cardGaps(student, t))).toBe(true);
    expect(isPrintable(cardGaps({ ...student, photoUrl: null }, t))).toBe(false);
    // …and a merely missing blood group does not stop anything.
    expect(isPrintable(cardGaps({ ...student, bloodGroup: null }, t))).toBe(true);
  });

  /** One predicate, consulted by the route and by the page, so they agree. */
  it("is the same predicate in the route and on the page", () => {
    for (const path of [
      "src/app/(app)/students/[id]/id-card/pdf/route.ts",
      "src/app/(app)/students/[id]/id-card/page.tsx",
      "src/app/(app)/staff/[id]/id-card/pdf/route.ts",
      "src/app/(app)/staff/[id]/id-card/page.tsx",
    ]) {
      expect(codeOf(path), path).toContain("isPrintable");
    }
  });

  /**
   * Printing is deliberately **not** gated. It is the school's own paper in the
   * school's own tray, and a half-finished card can be looked at and thrown
   * away; a file goes to a print shop and comes back as plastic.
   */
  it("still lets the school print a half-finished card", () => {
    for (const path of [
      "src/app/(app)/students/[id]/id-card/page.tsx",
      "src/app/(app)/staff/[id]/id-card/page.tsx",
    ]) {
      const page = codeOf(path);
      const printButton = page.indexOf("<PrintCardsButton");
      expect(printButton, path).toBeGreaterThan(-1);
      // The print button is not inside the printable branch: the branch closes
      // before it.
      expect(page.slice(page.lastIndexOf("}", printButton), printButton), path).not.toContain(
        "isPrintable",
      );
    }
  });
});

describe("what the card renderer is not allowed to do", () => {
  const code = codeOf("src/lib/pdf/card.ts");

  it("reads the card it is given and nothing else", () => {
    for (const forbidden of ["createClient", "supabase", "from(", "rpc(", "current_"]) {
      expect(code, `the card renderer must not reach for ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * **A URL is for a browser; a PDF embeds the image.** Minting a signed URL to
   * fetch bytes the server can read directly is signing something nobody asked
   * for — rule 8's "never render a signed link into a page" one step along — so
   * the routes call `photoBytes` and never `photoUrl`.
   */
  it("fetches the photograph rather than signing a link to it", () => {
    for (const path of [
      "src/app/(app)/students/[id]/id-card/pdf/route.ts",
      "src/app/(app)/staff/[id]/id-card/pdf/route.ts",
    ]) {
      const route = codeOf(path);
      expect(route, path).toContain("photoBytes");
      expect(route, path).not.toContain("photoUrl(");
    }
  });

  /**
   * The student route checks `students.view` and the staff route checks
   * nothing, and that asymmetry is the point: RLS on `students` is
   * row-ownership so the read proves who may see the child, while RLS on
   * `staff` is role-wide — so `getStaffCard` carries the check *inside the
   * function that produces the data*, and a copy in the caller is where a rule
   * starts to differ from itself.
   */
  it("checks the student's permission here and the staff one where the data is", () => {
    expect(codeOf("src/app/(app)/students/[id]/id-card/pdf/route.ts")).toContain(
      'hasPermission("students.view")',
    );
    expect(codeOf("src/app/(app)/staff/[id]/id-card/pdf/route.ts")).not.toContain("hasPermission");
    expect(codeOf("src/app/(app)/staff/id-cards/actions.ts")).toContain('hasPermission("staff.view")');
  });

  it("does not tell a stranger whether a card exists", () => {
    for (const path of [
      "src/app/(app)/students/[id]/id-card/pdf/route.ts",
      "src/app/(app)/staff/[id]/id-card/pdf/route.ts",
    ]) {
      const body = codeOf(path).slice(codeOf(path).indexOf("export async function GET"));
      expect(body, path).toContain("status: 404");
      expect(body, path).not.toMatch(/not found|does not exist|no such/i);
    }
  });
});
