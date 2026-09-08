import { describe, expect, it } from "vitest";
import {
  attentionCount,
  checkStatusLabel,
  checkTone,
  groupChecks,
  severityTone,
  type CheckRow,
} from "@/lib/validations/checks";

/**
 * The school-health page, browser half.
 *
 * `checks_run()` deliberately distinguishes four states, because three of them
 * would otherwise look identical on a screen: a check with nothing to say, one
 * the caller's role does not cover, and one that raised all produce no
 * problems. Collapsing them is the failure the whole surface exists to avoid —
 * so the grouping is what these tests pin.
 */

function row(over: Partial<CheckRow> & { key: string; status: string }): CheckRow {
  return {
    label: "A check",
    description: "What it looks for",
    module: "Fees",
    href: "/fees",
    severity: null,
    message: null,
    ...over,
  } as CheckRow;
}

describe("groupChecks", () => {
  it("turns one row per problem into one group per check", () => {
    const groups = groupChecks([
      row({ key: "a", status: "attention", severity: "warning", message: "first" }),
      row({ key: "a", status: "attention", severity: "info", message: "second" }),
      row({ key: "b", status: "ok" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].problems.map((p) => p.message)).toEqual(["first", "second"]);
    expect(groups[1].status).toBe("ok");
    expect(groups[1].problems).toHaveLength(0);
  });

  it("keeps a clean check apart from one nobody may see", () => {
    const groups = groupChecks([row({ key: "a", status: "ok" }), row({ key: "b", status: "withheld" })]);
    expect(groups[0].status).toBe("ok");
    expect(groups[1].status).toBe("withheld");
    expect(checkStatusLabel(groups[0].status)).not.toBe(checkStatusLabel(groups[1].status));
  });

  // The one that matters. A critic that raised has not passed, and a check with
  // one error and two findings must not read as a working check with three.
  it("lets an error outrank ordinary findings", () => {
    const groups = groupChecks([
      row({ key: "a", status: "attention", severity: "warning", message: "a finding" }),
      row({ key: "a", status: "error", severity: "error", message: "This check could not run: boom" }),
    ]);

    expect(groups[0].status).toBe("error");
    expect(checkTone("error")).toBe("destructive");
  });

  it("does not invent a problem out of a row with no message", () => {
    const groups = groupChecks([row({ key: "a", status: "attention", severity: "warning" })]);
    expect(groups[0].status).toBe("attention");
    expect(groups[0].problems).toHaveLength(0);
  });
});

describe("attentionCount", () => {
  it("counts findings, not checks, and ignores the clean and the withheld", () => {
    const groups = groupChecks([
      row({ key: "a", status: "attention", severity: "warning", message: "one" }),
      row({ key: "a", status: "attention", severity: "warning", message: "two" }),
      row({ key: "b", status: "ok" }),
      row({ key: "c", status: "withheld" }),
      row({ key: "d", status: "error", severity: "error", message: "broken" }),
    ]);

    expect(attentionCount(groups)).toBe(3);
  });

  it("is zero for a school with nothing to do", () => {
    expect(attentionCount(groupChecks([row({ key: "a", status: "ok" })]))).toBe(0);
  });
});

describe("tones", () => {
  it("never shows a withheld check as a passing one", () => {
    expect(checkTone("withheld")).not.toBe(checkTone("ok"));
  });

  it("separates the runner's own error from a critic's warning", () => {
    expect(severityTone("error")).toBe("destructive");
    expect(severityTone("warning")).toBe("warning");
    expect(severityTone("info")).toBe("secondary");
  });
});
