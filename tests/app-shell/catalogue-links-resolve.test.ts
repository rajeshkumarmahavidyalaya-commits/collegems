import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A link written into a catalogue (reference.checks, reference.reports) is a
 * string in a migration, so nothing compiles it against the routes. Two checks
 * sent the office to /schedules and one to /notifications/templates for as
 * long as they existed, and only a walk of every page in a fresh college
 * found the 404s (0335).
 *
 * Reads every '/…' literal in a statement that writes one of those catalogues
 * and requires a page to answer it. Addresses retired by a later migration are
 * named with the migration that replaced them: migrations are immutable, so the
 * old literal stays in its file.
 */
const ROOT = process.cwd();
const RETIRED: Record<string, string> = {
  "/notifications/templates": "0335",
  "/schedules": "0335",
};

function routes(): RegExp[] {
  const app = join(ROOT, "src/app");
  const out: RegExp[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "page.tsx" || name === "route.ts") {
        const segs = relative(app, dir)
          .split(sep)
          .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")));
        const pattern = "/" + segs.map((s) => (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/");
        out.push(new RegExp(`^${pattern === "/" ? "/" : pattern}$`));
      }
    }
  };
  walk(app);
  return out;
}

function catalogueLinks(): { file: string; href: string }[] {
  const dir = join(ROOT, "supabase/migrations");
  const out: { file: string; href: string }[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(/;\s*\n/)) {
      if (!/reference\.(checks|reports)\b/.test(stmt) || !/\b(insert|update)\b/i.test(stmt)) continue;
      // Only hrefs: a column descriptor's "href" key, or a check row's path.
      for (const m of stmt.matchAll(/(?:"href"\s*:\s*"|')(\/[a-z][a-z0-9\-/{}_]*)(?="|')/g)) {
        out.push({ file, href: m[1] });
      }
    }
  }
  return out;
}

describe("every link a catalogue writes goes somewhere", () => {
  const pages = routes();
  const resolves = (href: string) => {
    const path = href.replace(/\{[^}]+\}/g, "x").replace(/\/$/, "") || "/";
    return pages.some((r) => r.test(path));
  };

  it("finds the links it is meant to read", () => {
    const hrefs = new Set(catalogueLinks().map((l) => l.href));
    expect(hrefs.has("/fees/students/{student_id}")).toBe(true);
    expect(hrefs.has("/settings/team")).toBe(true);
  });

  it("each resolves to a page, or is named as retired", () => {
    const broken = catalogueLinks()
      .filter((l) => !(l.href in RETIRED) && !resolves(l.href))
      .map((l) => `${l.file}: ${l.href}`);
    expect([...new Set(broken)]).toEqual([]);
  });

  it("a retired address is really gone", () => {
    for (const href of Object.keys(RETIRED)) expect(resolves(href), href).toBe(false);
  });
});
