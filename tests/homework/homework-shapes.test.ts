import { describe, expect, it } from "vitest";
import {
  dueLabel,
  formatMark,
  homeworkSchema,
  markProblem,
  markingProgress,
  schoolToday,
  studyMaterialSchema,
  submissionStatusLabel,
} from "@/lib/validations/homework";
import {
  BUCKETS,
  BUCKET_LIMITS,
  formatBytes,
  safeFileName,
} from "@/lib/storage/constants";

/**
 * The homework module's pure logic.
 *
 * The interesting half is in Postgres — `homework_submit` refusing a non-student,
 * `homework_unpublish` refusing once work has come in — and is asserted in
 * `homework-flow.test.ts`. What is left here is the boundary the browser owns:
 * what a teacher may type, what a filename may contain, and what a date means
 * to a parent reading it at eight in the evening.
 */

function hw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sectionId: "11111111-1111-4111-8111-111111111111",
    subjectId: "22222222-2222-4222-8222-222222222222",
    title: "Chapter 4, questions 1-8",
    instructions: "Show your working.",
    assignedOn: "2026-09-01",
    dueOn: "2026-09-04",
    maxMarks: "",
    collectsSubmissions: true,
    ...overrides,
  };
}

describe("setting homework", () => {
  it("accepts the ordinary case, unmarked and collected", () => {
    expect(homeworkSchema.safeParse(hw()).success).toBe(true);
  });

  it("refuses a due date before the day it was set", () => {
    const result = homeworkSchema.safeParse(hw({ dueOn: "2026-08-30" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["dueOn"]);
  });

  it("allows homework due the same day it is set", () => {
    expect(homeworkSchema.safeParse(hw({ dueOn: "2026-09-01" })).success).toBe(true);
  });

  it("treats a blank maximum as 'not marked out of anything', not as zero", () => {
    // The whole reason `maxMarks` is a string: an empty box and a zero are
    // different facts, and `z.coerce` would collapse them.
    expect(homeworkSchema.safeParse(hw({ maxMarks: "" })).success).toBe(true);
    expect(homeworkSchema.safeParse(hw({ maxMarks: "0" })).success).toBe(false);
  });

  it("refuses to mark work that is not collected", () => {
    const result = homeworkSchema.safeParse(
      hw({ collectsSubmissions: false, maxMarks: "20" }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("not collected");
  });

  it("allows uncollected homework with no maximum", () => {
    expect(
      homeworkSchema.safeParse(hw({ collectsSubmissions: false, maxMarks: "" })).success,
    ).toBe(true);
  });
});

describe("marking", () => {
  it("treats an empty box as 'not marked yet'", () => {
    expect(markProblem("", 20)).toBeNull();
    expect(markProblem("  ", 20)).toBeNull();
  });

  it("refuses a mark above the maximum", () => {
    expect(markProblem("25", 20)).toBe("Above the maximum of 20");
  });

  it("refuses a mark on homework that has no maximum", () => {
    expect(markProblem("8", null)).toBe("This homework is not marked out of anything");
  });

  it("accepts a half mark, zero, and the maximum itself", () => {
    for (const value of ["0", "9.5", "20"]) {
      expect(markProblem(value, 20), value).toBeNull();
    }
  });

  it("shows an unmarked submission as an em dash, never as a zero", () => {
    expect(formatMark(null, 20)).toBe("— / 20");
    expect(formatMark(0, 20)).toBe("0 / 20");
    expect(formatMark(null, null)).toBe("—");
  });

  it("counts handed-in and marked separately", () => {
    const rows = [
      { status: "pending" },
      { status: "pending" },
      { status: "submitted" },
      { status: "returned" },
      { status: "graded" },
    ];
    expect(markingProgress(rows)).toEqual({
      total: 5,
      handedIn: 3,
      marked: 2,
      pending: 2,
    });
  });

  it("names every status in words, so colour is never the only signal", () => {
    for (const status of ["pending", "submitted", "graded", "returned"]) {
      expect(submissionStatusLabel(status)).not.toBe(status);
      expect(submissionStatusLabel(status).length).toBeGreaterThan(0);
    }
  });
});

describe("what a due date means to a person", () => {
  it("counts in days, not in dates", () => {
    expect(dueLabel("2026-09-03", "2026-09-03")).toBe("Due today");
    expect(dueLabel("2026-09-04", "2026-09-03")).toBe("Due tomorrow");
    expect(dueLabel("2026-09-02", "2026-09-03")).toBe("Due yesterday");
    expect(dueLabel("2026-09-08", "2026-09-03")).toBe("Due in 5 days");
    expect(dueLabel("2026-08-31", "2026-09-03")).toBe("3 days overdue");
  });

  it("counts across a month boundary rather than within one", () => {
    expect(dueLabel("2026-10-01", "2026-09-30")).toBe("Due tomorrow");
  });

  it("resolves today where the school is, not where the server is", () => {
    // 23:30 UTC on the 3rd is already the 4th in Kolkata. Vercel runs in UTC
    // and the school does not, which is the same rule `report_day_bounds()`
    // exists for on the SQL side.
    const late = new Date("2026-09-03T23:30:00Z");
    expect(schoolToday("Asia/Kolkata", late)).toBe("2026-09-04");
    expect(schoolToday("UTC", late)).toBe("2026-09-03");
  });
});

describe("study material is a file or a link, never both", () => {
  const base = {
    title: "Revision notes",
    description: "",
    sectionId: "",
    subjectId: "",
    isPublished: false,
  };

  it("requires a web address for a video or a link", () => {
    expect(
      studyMaterialSchema.safeParse({ ...base, kind: "video", externalUrl: "" }).success,
    ).toBe(false);
    expect(
      studyMaterialSchema.safeParse({ ...base, kind: "link", externalUrl: "" }).success,
    ).toBe(false);
  });

  it("accepts a document with no address, because the file is checked in the action", () => {
    expect(
      studyMaterialSchema.safeParse({ ...base, kind: "document", externalUrl: "" }).success,
    ).toBe(true);
  });

  it("treats an empty class and subject as answers, not omissions", () => {
    // Null section means the whole school and null subject means general, so
    // the empty string must parse rather than fail as a missing uuid.
    const result = studyMaterialSchema.safeParse({
      ...base,
      kind: "link",
      externalUrl: "https://example.org/notes",
    });
    expect(result.success).toBe(true);
  });

  it("refuses something that is not a web address", () => {
    const result = studyMaterialSchema.safeParse({
      ...base,
      kind: "link",
      externalUrl: "notes.pdf",
    });
    expect(result.success).toBe(false);
  });
});

describe("a filename can never move an object", () => {
  it("strips path separators, because the tenant prefix is the storage boundary", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("a/b/c/answers.pdf")).toBe("answers.pdf");
    expect(safeFileName("a\\b\\answers.pdf")).toBe("answers.pdf");
  });

  it("never returns a name that starts a new path segment or a dotfile", () => {
    for (const name of ["../x", "./x", "...", "/", "\\", ""]) {
      const safe = safeFileName(name);
      expect(safe, name).not.toContain("/");
      expect(safe, name).not.toContain("\\");
      expect(safe.startsWith("."), name).toBe(false);
      expect(safe.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps an ordinary name readable", () => {
    expect(safeFileName("Chapter 4 answers.pdf")).toBe("Chapter 4 answers.pdf");
  });

  it("collapses a run of dots so no traversal survives the replacement", () => {
    expect(safeFileName("a....b.pdf")).toBe("a.b.pdf");
  });
});

describe("bucket limits are shared, not duplicated", () => {
  it("declares a limit and an accept list for every bucket", () => {
    for (const bucket of Object.values(BUCKETS)) {
      const limits = BUCKET_LIMITS[bucket];
      expect(limits, bucket).toBeDefined();
      expect(limits.maxBytes, bucket).toBeGreaterThan(0);
      expect(limits.accept.length, bucket).toBeGreaterThan(0);
    }
  });

  it("does not accept an executable anywhere", () => {
    for (const bucket of Object.values(BUCKETS)) {
      for (const type of BUCKET_LIMITS[bucket].accept) {
        expect(type, `${bucket}: ${type}`).not.toMatch(/executable|x-msdownload|x-sh/);
      }
    }
  });

  it("renders a size in a unit a person reads", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
    expect(formatBytes(null)).toBe("—");
  });
});
