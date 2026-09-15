import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A tier written out by hand.
 *
 * `roles.tier` names the three audiences and `roles.subject` says what a login
 * stands for. Both are columns, both are per-college rows, and a page that
 * re-derives either one as a list of role codes has made a copy — which is fine
 * until the day the two disagree.
 *
 * They did. `/homework` chose its screen with
 * `roleCode === "admin" || roleCode === "teacher"`, which is *two of the four*
 * staff roles, so an accountant and a librarian fell through to the family
 * screen. Probed as each of them against the live college: `homework` **0
 * rows**, `family_my_students()` **0**. Neither role has a SELECT policy on
 * that table at all, so the screen greeted them as a family and had nothing on
 * it — and nobody reports that, because nobody signs into those two seats.
 *
 * ## …but a list that copies a policy's own list is not this mistake
 *
 * `/notices/[id]` tests `["admin", "teacher"]` too, and it is **right**:
 * `notice_reads` carries exactly one staff policy,
 * `current_role_code() = ANY (ARRAY['admin', 'teacher'])`, and widening the
 * page to the staff tier would hand an accountant a read summary computed from
 * their own single read receipt — a plausible number, which is the quiet
 * failure CLAUDE.md names for an invoker function over row-ownership RLS.
 *
 * So the rule is not "never compare a role code". It is: **comparing two or
 * more of them is a claim about an audience, and a claim needs a reason.** One
 * comparison is a mirror of one policy and stays; a disjunction is named here
 * with the policy it copies, or it is a tier and belongs on `roleTier`.
 */
const MIRRORS_A_POLICY = new Map<string, string>([
  [
    "src/app/(app)/notices/[id]/page.tsx",
    "notice_reads' `staff view notice reads` policy is admin + teacher; an " +
      "accountant would be shown a read rate computed from their own receipt.",
  ],
]);

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");
const COMPONENTS = join(ROOT, "src/components");

/** Comments stripped, in both syntaxes — a guard that reads prose reports on it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/.*$/, ""))
    .join("\n");
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, acc);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

/**
 * The role codes a file compares `roleCode` against.
 *
 * Both shapes this codebase uses: `roleCode === "x"` (either side of the
 * operator, and `!==` too) and `["a", "b"].includes(roleCode)`. `navForRole`
 * takes a role code as a *parameter* and compares nothing, which is why the
 * match is anchored on the comparison rather than on the word.
 */
function comparedRoleCodes(body: string): string[] {
  const found = new Set<string>();

  for (const m of body.matchAll(/roleCode\s*[!=]==?\s*"([a-z_]+)"/g)) found.add(m[1]);
  for (const m of body.matchAll(/"([a-z_]+)"\s*[!=]==?\s*(?:\w+[.?]*)*roleCode/g)) found.add(m[1]);
  for (const m of body.matchAll(/\[([^\]]*)\]\s*\.includes\(\s*(?:\w+[.?]*)*roleCode/g)) {
    for (const q of m[1].match(/"([a-z_]+)"/g) ?? []) found.add(q.slice(1, -1));
  }

  return [...found].sort();
}

describe("a page does not re-derive an audience from role codes", () => {
  it("names every screen that tests more than one role code", () => {
    const offenders: string[] = [];

    for (const file of [...sourceFiles(APP), ...sourceFiles(COMPONENTS)]) {
      const rel = file.slice(ROOT.length + 1);
      const codes = comparedRoleCodes(code(readFileSync(file, "utf8")));
      if (codes.length < 2) continue;
      if (MIRRORS_A_POLICY.has(rel)) continue;
      offenders.push(`${rel} (${codes.join(", ")})`);
    }

    expect(
      offenders,
      "Two or more role codes in one screen is a tier written out by hand. Use " +
        "`ctx.roleTier` for which audience and `ctx.roleSubject` for whose " +
        "record — or, if it really is a copy of one policy's own list, add it " +
        "to MIRRORS_A_POLICY naming that policy.",
    ).toEqual([]);
  });

  it("detects the shape it is looking for", () => {
    // A negative control pinned to a real defect expires when the defect is
    // fixed, and fails looking exactly like a regression — so both samples are
    // synthetic. The first is `/homework` as it shipped.
    expect(
      comparedRoleCodes(`const isStaff = ctx?.roleCode === "admin" || ctx?.roleCode === "teacher";`),
    ).toEqual(["admin", "teacher"]);
    expect(comparedRoleCodes(`["admin", "teacher"].includes(ctx?.roleCode ?? "")`)).toEqual([
      "admin",
      "teacher",
    ]);
    expect(comparedRoleCodes(`if (ctx.roleCode !== "parent" && ctx.roleCode !== "student")`)).toEqual(
      ["parent", "student"],
    );
    // One comparison is a mirror of one policy and is not this mistake.
    expect(comparedRoleCodes(`if (ctx.roleCode === "teacher") {`)).toEqual(["teacher"]);
    // And the parameter that gave the function its name is not a comparison.
    expect(comparedRoleCodes(`export function navForRole(roleCode: string)`)).toEqual([]);
  });

  it("keeps a declaration only while the screen still makes that comparison", () => {
    // The nav allowlist rotted in exactly this way — read in one direction, so
    // a line survived the decision it described. This is the other direction.
    const stale = [...MIRRORS_A_POLICY.keys()].filter(
      (rel) => comparedRoleCodes(code(readFileSync(join(ROOT, rel), "utf8"))).length < 2,
    );
    expect(stale, "this screen no longer compares two role codes; drop the line").toEqual([]);
  });
});
