import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const NAV_CONFIG = "src/components/app-shell/nav-config.ts";

/**
 * Comments stripped, so a guard reads the code rather than the prose.
 *
 * This file's own doc comment names `NAV_GROUPS` several times, and the
 * palette's names it once while explaining why it no longer imports it. Both
 * would pass an unstripped check for exactly the wrong reason — the fourth
 * time this repository has paid for it, after the operator-boundary guard
 * passing on a commented-out revoke, the Server-Component guard failing on a
 * comment saying `useI18n` must not be used, and the `.or(` guard failing on
 * the comment explaining why `.or(` was replaced.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
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
 * Who a menu entry is for is decided once, and the whole application reads the
 * decision through `navForRole`.
 *
 * `tests/app-shell/nav-audience.test.ts` guards the `roles` lists themselves —
 * whether somebody *decided*. It cannot ask whether every renderer honoured the
 * decision, and for as long as the app shell has existed one of them did not:
 * the sidebar called `navForRole(roleCode)` and the command palette imported
 * `NAV_GROUPS` raw, so a guardian was offered **54 of 54** entries where the
 * sidebar gave them 10 — *Payroll*, *Fee counter*, *Voucher book*, *Delivery
 * log* and *What each role may do* among them.
 *
 * > **A guard on a list is not a guard on its consumers.**
 *
 * None of it was a security boundary; rule 4's first sentence is that the menu
 * is never the gate. It was a claim about who the product is for, made twice,
 * differently, on the same screen.
 */
describe("the nav tree has one filter", () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(ROOT, path),
    body: code(readFileSync(path, "utf8")),
  }));

  it("is read raw only where it is defined", () => {
    const raw = files
      .filter((f) => f.path !== NAV_CONFIG && /\bNAV_GROUPS\b/.test(f.body))
      .map((f) => f.path);

    expect(
      raw,
      "NAV_GROUPS is the unfiltered list. Reading it outside nav-config.ts means " +
        "rendering entries the caller's role was never offered — which is how the " +
        "command palette came to show a guardian the payroll screen. Call " +
        "navForRole(roleCode), or take the built tree as a prop.",
    ).toEqual([]);
  });

  it("is filtered in exactly one place", () => {
    const callers = files.filter((f) => /navForRole\s*\(/.test(f.body)).map((f) => f.path);

    // Two callers is where two answers come from. The shell builds the tree and
    // hands the same object to the sidebar and to the palette.
    expect(callers).toEqual([NAV_CONFIG, "src/components/app-shell/shell.tsx"]);
  });

  it("reaches the palette as a prop", () => {
    const palette = code(
      readFileSync(join(ROOT, "src/components/app-shell/command-palette.tsx"), "utf8"),
    );
    // Anchored on the closing brace: `NavGroup[] | undefined` is an optional
    // prop, and a palette whose tree may be absent renders no navigation at
    // all — which is the same defect wearing the other face.
    expect(palette).toMatch(/navGroups\s*:\s*NavGroup\[\]\s*\}/);
    expect(palette).toMatch(/navGroups\.map\(/);
  });

  /**
   * The palette drew `item.title` where the sidebar drew `t(item.messageKey)`,
   * so one nav entry was translated in one half of the shell and English in the
   * other. Rule 15's sentence about the interface, inside one component.
   */
  it("translates the entries it draws", () => {
    const palette = code(
      readFileSync(join(ROOT, "src/components/app-shell/command-palette.tsx"), "utf8"),
    );
    expect(palette).toMatch(/item\.messageKey\s*\?\s*t\(item\.messageKey\)/);
    expect(palette).toMatch(/group\.messageKey\s*\?\s*t\(group\.messageKey\)/);
  });
});

/**
 * Where a search hit goes belongs to the renderer, and the renderer must not
 * grow a second opinion about it.
 *
 * Every student and every member of staff in the palette linked to
 * `/library/members` — a real defect, on the one control that is on all 94
 * pages, and invisible because a link that goes somewhere is not a link that
 * errors. `searchHitHref` is the one mapping, and rule 11's own guard shape
 * applies: check that the component **calls** it and carries no route literal
 * of its own, because a test asserting only that `/students/` appears would
 * pass on the shortcut it exists to forbid.
 */
describe("a search hit's destination", () => {
  const palette = code(
    readFileSync(join(ROOT, "src/components/app-shell/command-palette.tsx"), "utf8"),
  );

  it("is resolved by searchHitHref", () => {
    expect(palette).toMatch(/go\(searchHitHref\(hit\)\)/);
  });

  it("is not also written out in the component", () => {
    // Nav entries arrive as data, so the only string literals that look like a
    // route in this file should be none at all.
    const literals = [...palette.matchAll(/"\/[a-z][^"]*"/g)].map((m) => m[0]);
    expect(literals).toEqual([]);
  });
});
