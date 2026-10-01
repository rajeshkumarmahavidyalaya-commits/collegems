import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A screen that only needs a label must not pay for the schema library.
 *
 * Measured on 1 Oct 2026: zod was **126 kB** of JavaScript (two chunks, about
 * 35 kB compressed) on 45 routes, and on most of them nothing validated
 * anything -- `/students` imported `STUDENT_STATUSES` from `students.ts`, whose
 * first line is `import { z } from "zod"`, and webpack cannot drop a module's
 * side-effect-free neighbours once the module itself is reached. CLAUDE.md
 * already names this ("a barrel that mixes a Zod schema with a label helper
 * charges every importer for Zod") and `fees-display.ts` was the one fixed
 * instance. Twenty-five modules now have a `-display` half.
 *
 * Two guards, because the mistake has two halves:
 *
 *  1. a `-display` module never reaches zod at runtime, directly or through a
 *     value import of another module that does (a type import is erased, so
 *     `import type { X } from "./students"` is allowed and is how a display
 *     helper names a schema's inferred type);
 *  2. a client component imports nothing but schemas, and only where it builds
 *     a form, from a module that loads zod -- every label, list and sentence
 *     comes from the light half.
 */
const ROOT = process.cwd();
const V = join(ROOT, "src/lib/validations");
const read = (p: string) => readFileSync(p, "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Does this validations module load zod when it is imported for a value? */
function loadsZod(mod: string, seen = new Set<string>()): boolean {
  if (seen.has(mod)) return false;
  seen.add(mod);
  let src: string;
  try {
    src = code(read(join(V, `${mod}.ts`)));
  } catch {
    return false;
  }
  if (/^import\s+(?!type\b)[^;]*from\s+"zod"/m.test(src)) return true;
  for (const m of src.matchAll(/^(?:import|export)\s+(?!type\b)\{([^}]*)\}\s+from\s+"\.\/([\w-]+)"/gm)) {
    const valueSpecs = m[1].split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type "));
    if (valueSpecs.length && loadsZod(m[2], seen)) return true;
  }
  for (const m of src.matchAll(/^export\s+\*\s+from\s+"\.\/([\w-]+)"/gm)) {
    if (loadsZod(m[1], seen)) return true;
  }
  return false;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("a label does not load the schema library", () => {
  it("no -display module reaches zod at runtime", () => {
    const display = readdirSync(V).filter((f) => f.endsWith("-display.ts")).map((f) => f.replace(/\.ts$/, ""));
    expect(display.length).toBeGreaterThanOrEqual(25);
    for (const mod of display) expect(loadsZod(mod), mod).toBe(false);
  });

  it("a client component takes only schemas from a module that loads zod", () => {
    const offenders: string[] = [];
    for (const file of [...walk(join(ROOT, "src/app")), ...walk(join(ROOT, "src/components"))]) {
      const src = read(file);
      if (!/^\s*["']use client["']/.test(src)) continue;
      for (const m of src.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+"@\/lib\/validations\/([\w-]+)"/gm)) {
        if (!loadsZod(m[2])) continue;
        const names = m[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith("type "))
          .map((s) => s.split(" as ")[0].trim());
        // A schema is the reason to load zod; so is the one helper that runs
        // a schema (`parseTemplateFields` parses with `z.array(...)`).
        const light = names.filter((n) => !/Schema$/.test(n) && !ALLOWED_HEAVY.has(n));
        if (light.length) offenders.push(`${file.replace(ROOT + "/", "")}: ${light.join(", ")} from ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the guard itself sees a module that loads zod, and one that does not", () => {
    expect(loadsZod("students")).toBe(true);
    expect(loadsZod("students-display")).toBe(false);
  });
});

/** Value exports that genuinely run zod, so a client importing them is right to. */
const ALLOWED_HEAVY = new Set<string>([]);
