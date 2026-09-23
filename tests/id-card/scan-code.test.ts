import { readFileSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrModules } from "@/lib/id-card/qr";
import { qrRectangles } from "@/lib/pdf/card";
import { parseScanCode, scanCodeFor, scanTarget } from "@/lib/validations/scan-code";
import { staffFace, studentFace } from "@/lib/validations/id-card";
import type { Translator } from "@/lib/i18n/translate";

const ROOT = join(__dirname, "..", "..");
const STUDENT = "83f1e640-45da-44df-811b-3d4a7093bb3c";
const STAFF = "0cfe5a09-78fb-4dc2-bc88-7f9d79ab3fee";

/** The matrix drawn as black-on-white pixels, the way a camera would see a printed card. */
function pixels(modules: boolean[][], scale = 6, quiet = 4) {
  const n = modules.length + quiet * 2;
  const size = n * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }),
  );
  return { data, size };
}

/**
 * The code printed on a card and the thing that reads it, proven to agree.
 *
 * An encoder and a decoder chosen separately can each be correct and still not
 * speak to each other -- a byte mode one expects and the other does not, an
 * error-correction level too low for a worn card. So the matrix the card draws
 * is rendered to pixels and decoded by **the same `jsQR`** the scan screen
 * falls back to on Safari and Firefox.
 */
describe("the card and the scanner speak the same code", () => {
  it.each([
    ["student", STUDENT],
    ["staff", STAFF],
  ] as const)("a %s card decodes back to the card", (kind, id) => {
    const text = scanCodeFor(kind, id);
    const { data, size } = pixels(qrModules(text));
    const read = jsQR(data, size, size);
    expect(read?.data).toBe(text);
    expect(parseScanCode(read!.data)).toEqual({ kind, id });
  });

  it("is the size the card is laid out for", () => {
    // 44pt on the PDF and 19% of the face are sized for 33 modules; a longer
    // payload would shrink every module on every card.
    expect(qrModules(scanCodeFor("student", STUDENT))).toHaveLength(33);
  });

  it("routes to the record page, which decides who may see it", () => {
    expect(scanTarget({ kind: "student", id: STUDENT })).toBe(`/students/${STUDENT}`);
    expect(scanTarget({ kind: "staff", id: STAFF })).toBe(`/staff/${STAFF}`);
  });
});

describe("the PDF draws the code the right way up", () => {
  it("its rectangles, read as a page is seen, rebuild the matrix and decode", () => {
    // PDF's y runs up the page and the matrix's rows run down it; a code drawn
    // upside down is a mirror image, which a standard decoder refuses. So the
    // rectangles are read back top-down, as a camera sees the printed card.
    const text = scanCodeFor("student", STUDENT);
    const modules = qrModules(text);
    const size = 44;
    const unit = size / (modules.length + 4);
    const rebuilt = modules.map((row) => row.map(() => false));
    for (const rect of qrRectangles(modules, 100, 10, size)) {
      const top = 10 + size - (rect.y + rect.height); // distance down from the code's top edge
      const row = Math.round(top / unit) - 2;
      const first = Math.round((rect.x - 100) / unit) - 2;
      const count = Math.round(rect.width / unit);
      for (let c = first; c < first + count; c++) rebuilt[row][c] = true;
    }
    expect(rebuilt).toEqual(modules);
    const { data, size: px } = pixels(rebuilt);
    expect(jsQR(data, px, px)?.data).toBe(text);
  });
});

describe("the parser takes only this product's cards", () => {
  it.each([
    "https://example.com/students/" + STUDENT,
    `sos:guardian:${STUDENT}`,
    `sos:student:${STUDENT}/../../settings`,
    `sos:student:not-a-uuid`,
    "WIFI:T:WPA;S:school;P:secret;;",
    "8901234567890",
    "",
  ])("refuses %j", (text) => {
    expect(parseScanCode(text)).toBeNull();
  });

  it("tolerates what a scanner adds: case and surrounding space", () => {
    expect(parseScanCode(`  SOS:STUDENT:${STUDENT.toUpperCase()}\n`)).toEqual({ kind: "student", id: STUDENT });
  });
});

describe("every card carries its own code", () => {
  const t = ((k: string) => k) as unknown as Translator;

  it("a student's face says student, a colleague's says staff", () => {
    const student = studentFace(
      {
        studentId: STUDENT,
        fullName: "Aryan Pandey",
        admissionNumber: "A1",
        className: null,
        rollNumber: null,
        dateOfBirth: null,
        bloodGroup: null,
        guardianName: null,
        guardianPhone: null,
        address: null,
        photoUrl: null,
        photoPath: null,
      },
      t,
      (v) => v,
      "en",
    );
    const staff = staffFace(
      {
        staffId: STAFF,
        fullName: "Rajesh Kumar",
        employeeCode: "E1",
        designation: "Teacher",
        department: null,
        phone: null,
        bloodGroup: null,
        photoUrl: null,
        photoPath: null,
      },
      t,
    );
    expect(parseScanCode(student.scanCode)).toEqual({ kind: "student", id: STUDENT });
    expect(parseScanCode(staff.scanCode)).toEqual({ kind: "staff", id: STAFF });
  });
});

describe("what reaches a browser", () => {
  it("the parser imports nothing", () => {
    const src = readFileSync(join(ROOT, "src/lib/validations/scan-code.ts"), "utf8");
    expect(src).not.toMatch(/^import /m);
  });

  it("the decoder is loaded when the camera starts, not with the page", () => {
    const scanner = readFileSync(join(ROOT, "src/app/(app)/scan/scanner.tsx"), "utf8");
    expect(scanner).toContain('await import("jsqr")');
    expect(scanner).not.toMatch(/^import .*["']jsqr["']/m);
    // And the encoder never reaches it at all.
    expect(scanner).not.toContain("qrcode-generator");
    expect(scanner).not.toContain("@/lib/id-card/qr");
  });
});
