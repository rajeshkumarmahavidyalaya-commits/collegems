import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  cleanExtra,
  countBySeverity,
  issueCertificateSchema,
  cancelCertificateSchema,
  kindLabel,
  KIND_CONSEQUENCE,
  missingRequiredFields,
  parsePreview,
  parseTemplateFields,
  sortProblems,
} from "@/lib/validations/certificates";

/**
 * The certificates module's client half, without a database.
 *
 * The engine's judgements are all server-side and tested there. What is pinned
 * here is the small set of decisions the screen makes on its own, and each one
 * is a way the module could quietly go wrong:
 *
 *   - a box somebody tabbed through must not count as filled in;
 *   - a template descriptor that drifted must degrade, not crash the page;
 *   - `can_issue` is the server's answer and must never be recomputed here.
 */

// The labels are looked up in the reader's catalogue now, so the tests
// supply one. English is asserted here; three-locale coverage is the floor in
// tests/i18n.
const t = createTranslator("en");

describe("a template's own fields", () => {
  it("reads a well-formed descriptor", () => {
    const fields = parseTemplateFields([
      { name: "reason", label: "Reason for leaving", required: true },
    ]);
    expect(fields).toEqual([
      { name: "reason", label: "Reason for leaving", required: true },
    ]);
  });

  it("defaults a field to optional", () => {
    expect(parseTemplateFields([{ name: "note", label: "Note" }])[0].required).toBe(false);
  });

  it("returns nothing for a descriptor that is not a list", () => {
    // A migration could write anything into `fields`. The issuing screen going
    // blank is bad; the issuing screen crashing for every certificate is worse.
    expect(parseTemplateFields({ name: "x" })).toEqual([]);
    expect(parseTemplateFields(null)).toEqual([]);
    expect(parseTemplateFields([{ label: "no name" }])).toEqual([]);
  });
});

describe("what counts as filled in", () => {
  it("treats whitespace as empty", () => {
    // The whole refusal mechanism rests on this: a blank "reason for leaving"
    // has to leave its placeholder standing so the server refuses, rather than
    // printing a certificate with a gap where the reason should be.
    expect(cleanExtra({ reason: "   ", conduct: "Good" })).toEqual({ conduct: "Good" });
  });

  it("trims what it keeps", () => {
    expect(cleanExtra({ reason: "  Relocating  " })).toEqual({ reason: "Relocating" });
  });

  it("names the required fields still empty", () => {
    const fields = parseTemplateFields([
      { name: "reason", label: "Reason", required: true },
      { name: "conduct", label: "Conduct", required: true },
      { name: "note", label: "Note" },
    ]);
    expect(missingRequiredFields(fields, { conduct: "Good", note: "" })).toEqual(["reason"]);
    expect(missingRequiredFields(fields, { conduct: "Good", reason: "  " })).toEqual(["reason"]);
    expect(missingRequiredFields(fields, { conduct: "Good", reason: "Moving" })).toEqual([]);
  });
});

describe("the preview the server sends", () => {
  const good = {
    template_id: "00000000-0000-4000-8000-000000000001",
    template_name: "Transfer Certificate",
    kind: "transfer",
    fields: [],
    body: "This is to certify that ...",
    unresolved: [],
    problems: [{ severity: "warning", message: "800.00 is still outstanding." }],
    can_issue: true,
  };

  it("parses a well-formed preview", () => {
    const parsed = parsePreview(good);
    expect(parsed).not.toBeNull();
    expect(parsed!.can_issue).toBe(true);
    expect(parsed!.problems).toHaveLength(1);
  });

  it("keeps can_issue as sent, even when it disagrees with the problems", () => {
    // Deliberate. `can_issue` is decided in Postgres by the same function
    // `certificate_issue` calls, so recomputing it here from `problems` would
    // be a second answer -- and the visible symptom of a second answer is a
    // button that looks enabled and then throws.
    const parsed = parsePreview({
      ...good,
      problems: [{ severity: "error", message: "Nothing filled {{reason}}." }],
      can_issue: true,
    });
    expect(parsed!.can_issue).toBe(true);
  });

  it("degrades an unknown severity rather than dropping the sentence", () => {
    const parsed = parsePreview({
      ...good,
      problems: [{ severity: "catastrophe", message: "Something the server knows about." }],
    });
    expect(parsed!.problems[0].severity).toBe("warning");
    expect(parsed!.problems[0].message).toBe("Something the server knows about.");
  });

  it("returns null rather than throwing on a shape it does not recognise", () => {
    expect(parsePreview({ body: "no can_issue" })).toBeNull();
    expect(parsePreview(null)).toBeNull();
  });

  it("defaults problems and unresolved to empty lists", () => {
    const parsed = parsePreview({
      template_id: good.template_id,
      template_name: good.template_name,
      kind: "bonafide",
      fields: [],
      body: "x",
      can_issue: true,
    });
    expect(parsed!.problems).toEqual([]);
    expect(parsed!.unresolved).toEqual([]);
  });
});

describe("how problems are shown", () => {
  it("puts what blocks first and what is only a note last", () => {
    const sorted = sortProblems([
      { severity: "info", message: "c" },
      { severity: "warning", message: "b" },
      { severity: "error", message: "a" },
    ]);
    expect(sorted.map((p) => p.message)).toEqual(["a", "b", "c"]);
  });

  it("counts them by severity", () => {
    expect(
      countBySeverity([
        { severity: "error", message: "a" },
        { severity: "error", message: "b" },
        { severity: "info", message: "c" },
      ]),
    ).toEqual({ error: 2, warning: 0, info: 1 });
  });
});

describe("what the form sends", () => {
  it("insists on a student, a template and a date", () => {
    const bad = issueCertificateSchema.safeParse({ studentId: "", templateId: "", issuedOn: "" });
    expect(bad.success).toBe(false);
  });

  it("defaults extra to an empty map", () => {
    const parsed = issueCertificateSchema.parse({
      studentId: "00000000-0000-4000-8000-000000000001",
      templateId: "00000000-0000-4000-8000-000000000002",
      issuedOn: "2026-09-07",
    });
    expect(parsed.extra).toEqual({});
  });

  it("will not cancel without a reason", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(cancelCertificateSchema.safeParse({ certificateId: id, reason: "" }).success).toBe(false);
    expect(cancelCertificateSchema.safeParse({ certificateId: id, reason: "oop" }).success).toBe(false);
    expect(
      cancelCertificateSchema.safeParse({ certificateId: id, reason: "Issued to the wrong child" })
        .success,
    ).toBe(true);
  });
});

describe("labels", () => {
  it("names every kind, and falls back to the raw value for one it has not met", () => {
    expect(kindLabel("transfer", t)).toBe("Transfer certificate");
    expect(kindLabel("sports_day", t)).toBe("sports_day");
  });

  it("warns before the one kind that changes a record, and only that one", () => {
    // Issuing a transfer certificate takes a child off the roll. Nothing else
    // here does, and a warning attached to everything is a warning nobody reads.
    expect(KIND_CONSEQUENCE.transfer).toMatch(/transferred/);
    expect(KIND_CONSEQUENCE.bonafide).toBeUndefined();
    expect(KIND_CONSEQUENCE.character).toBeUndefined();
  });
});
