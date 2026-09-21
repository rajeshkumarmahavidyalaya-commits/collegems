import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/** Comments stripped, so the guard reads the code and not the prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      sourceFiles(p, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

/**
 * A roll does not go in a dropdown.
 *
 * Two screens loaded every child into a flat `<Select>` and each was wrong in
 * its own way, measured on this college's **302** students:
 *
 * | screen | what it did | who it could reach |
 * |---|---|---|
 * | `/certificates/issue` | `.order("admission_number").limit(20)` | **20 of 302** |
 * | `/fees/concessions` | `.limit(500)`, on every page view | 302, in one dropdown |
 *
 * The first is a defect today. The second is a defect at 501 students, and a
 * 302-item scroll before then — **the same mistake with a more generous
 * bound**, which is exactly why it read as fine. *A bound nobody has reached is
 * not a bound somebody decided.*
 *
 * This is the session's own lesson turned on the fix: `student_search` replaced
 * four copies of one query, and the *picker* was about to become the fifth copy
 * — it was written inside `issue-form.tsx`, where the next screen would have
 * pasted it. **The second consumer decides the unit of work.**
 *
 * The bar is a **roll**, not a list. A college's staff is 15 people and stays
 * in its `<Select>` on the same form, deliberately.
 */
const A_ROLL_IN_A_SELECT_ON_PURPOSE = new Map<string, string>([]);

describe("a roll does not go in a dropdown", () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(ROOT, path),
    body: code(readFileSync(path, "utf8")),
  }));

  it("renders no student list as SelectItems", () => {
    const offenders = files
      .filter((f) => {
        // `students.map((s) => <SelectItem …>)` — the shape both screens had.
        for (const m of f.body.matchAll(/\b(\w*[sS]tudents)\s*\.map\(/g)) {
          if (/SelectItem/.test(f.body.slice(m.index, m.index + 400))) return true;
        }
        return false;
      })
      .map((f) => f.path)
      .filter((p) => !A_ROLL_IN_A_SELECT_ON_PURPOSE.has(p));

    expect(
      offenders,
      "A roll is hundreds of children and a <Select> shows them all at once — " +
        "or, worse, the query bounds itself and shows some of them. Use " +
        "<StudentPicker> over a search, or name the file in " +
        "A_ROLL_IN_A_SELECT_ON_PURPOSE with the reason the list is small.",
    ).toEqual([]);
  });

  it("has one picker, not one per screen", () => {
    const defines = files.filter((f) => /export function StudentPicker\b/.test(f.body));
    expect(defines.map((f) => f.path)).toEqual(["src/components/people/student-picker.tsx"]);
  });

  it("is used by importing it, never by copying it", () => {
    const users = files.filter(
      (f) => /<StudentPicker\b/.test(f.body) && !f.path.endsWith("student-picker.tsx"),
    );
    // Two screens today; the check is that each one *imports* the component.
    expect(users.length).toBeGreaterThanOrEqual(2);
    for (const f of users) {
      expect(f.body, `${f.path} should import the shared picker`).toMatch(
        /from "@\/components\/people\/student-picker"/,
      );
    }
  });

  /**
   * The picker takes its server action as a prop rather than importing one, so
   * a screen that must narrow the roll further supplies a different action.
   * Rule 8's split applied to a picker: share the choreography, keep the
   * authorization with the caller.
   */
  it("takes the search as a prop", () => {
    const picker = files.find((f) => f.path.endsWith("components/people/student-picker.tsx"))!;
    expect(picker.body).toMatch(/search:\s*\(term: string\)\s*=>\s*Promise</);
    expect(picker.body, "the shared picker must not reach for a caller's action").not.toMatch(
      /from "@\/app\//,
    );
  });
});
