import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, PROGRAMMES, SITE_PATHS, addressOneLine } from "@/lib/site/content";

// The college's public website is the one part of this product that anybody
// can read, so the checks here are about what it must not do and what it must
// not forget. None of them needs a database.

const ROOT = join(__dirname, "..", "..");
const SITE_DIR = join(ROOT, "src", "app", "(site)");
const SITE_FILES = [SITE_DIR, join(ROOT, "src", "components", "site"), join(ROOT, "src", "lib", "site")];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Comments out, then match: a comment can hide a violation and fake one. */
function code(file: string) {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const sources = SITE_FILES.flatMap(walk).filter((f) => /\.tsx?$/.test(f));

describe("the public website", () => {
  it("has a page behind every address it advertises", () => {
    for (const path of SITE_PATHS) {
      const page = join(SITE_DIR, path, "page.tsx");
      expect(existsSync(page), `${path} is in SITE_PATHS and has no ${relative(ROOT, page)}`).toBe(true);
    }
  });

  it("has its own 404 and error floor, since the ERP's sit inside a shell it lacks", () => {
    expect(existsSync(join(SITE_DIR, "not-found.tsx"))).toBe(true);
    expect(existsSync(join(SITE_DIR, "error.tsx"))).toBe(true);
  });

  it("has a page for every programme it lists, through one dynamic route", () => {
    expect(existsSync(join(SITE_DIR, "programmes", "[slug]", "page.tsx"))).toBe(true);
    expect(new Set(PROGRAMMES.map((p) => p.slug)).size).toBe(PROGRAMMES.length);
  });

  it("is public in the middleware from the same list, not a copy of it", () => {
    const mw = code(join(ROOT, "src", "middleware.ts"));
    expect(mw).toMatch(/SITE_PUBLIC_PATHS\s*=\s*\[\s*\.\.\.SITE_PATHS/);
    expect(mw).toMatch(/\[\.\.\.PUBLIC_PATHS,\s*\.\.\.SITE_PUBLIC_PATHS\]/);
    expect(mw).toContain('"/programmes"');
    // `/` is the dashboard for a signed-in person and the website for the rest.
    expect(mw).toMatch(/!user\s*&&\s*pathname\s*===\s*"\/"[\s\S]{0,80}NextResponse\.rewrite/);
  });

  it("collides with no screen of the signed-in application", () => {
    const app = readdirSync(join(ROOT, "src", "app", "(app)"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/${d.name}`);
    const mine = [...SITE_PATHS, "/programmes"];
    expect(mine.filter((p) => app.includes(p))).toEqual([]);
  });

  it("reads no table and calls no provider: its content is a file", () => {
    for (const f of sources) {
      const c = code(f);
      expect(c, relative(ROOT, f)).not.toMatch(/@\/lib\/supabase|createClient|\.rpc\(|\.from\(/);
      expect(c, relative(ROOT, f)).not.toMatch(/from\s+["']@\/app\/\(app\)/);
    }
  });

  it("hardcodes no colour: everything goes through the tokens", () => {
    for (const f of sources) {
      expect(code(f), relative(ROOT, f)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    }
  });

  it("uses logical utilities, so it survives a right-to-left reader", () => {
    for (const f of sources) {
      expect(code(f), relative(ROOT, f)).not.toMatch(/\b(?:ml|mr|pl|pr)-(?:\d|\[|auto)|\btext-(?:left|right)\b|\b(?:left|right)-\d/);
    }
  });

  it("keeps the header's navigation in step with the content list", () => {
    expect(NAV.map((n) => n.href)).toEqual(["/about", "/programmes", "/admissions", "/facilities", "/contact"]);
  });

  it("prints an address with no empty parts", () => {
    expect(addressOneLine()).not.toMatch(/,\s*,|undefined|null/);
  });

  it("does not claim an email or website nobody has given us", () => {
    const content = readFileSync(join(ROOT, "src", "lib", "site", "content.ts"), "utf8");
    // Unknown contact facts are null, so the contact page draws no row for them.
    expect(content).toMatch(/email:\s*null/);
    expect(content).toMatch(/website:\s*null/);
  });
});
