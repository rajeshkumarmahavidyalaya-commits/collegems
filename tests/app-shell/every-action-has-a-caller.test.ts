import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server action nothing imports is a write path nobody can call (rule 6's
 * sentence, in the interface). The 0333 sweep found eleven: cancelling an
 * invoice, raising one for a single student, ending a hostel stay, kinds of
 * staff leave, attaching a file to a notice, deleting a book, a route, a
 * schedule or an account, editing a posting rule, and the enquiry follow-up
 * log. Each existed, worked, and had no button.
 *
 * Imports are resolved to the module they come from, not matched by name:
 * the first sweep missed notices' `attachFile` because homework has an action
 * with the same name.
 */
const ROOT = process.cwd();

/** Exported on purpose with no caller in src, each with its reason. */
const NO_CALLER_ON_PURPOSE: Record<string, string> = {
  "src/app/(app)/fees/actions.ts#listPaymentLinks":
    "A payment link's history has no screen yet; links are created from the fee account and settle by webhook.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(normalize(p));
  }
  return out;
}

const files = walk(join(ROOT, "src")).map((f) => f.slice(ROOT.length + 1));
const src = new Map(files.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = normalize(base + ext);
    if (src.has(p) || existsSync(join(ROOT, p))) return p;
  }
  return null;
}

function importedNames(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const add = (p: string, n: string) => {
    if (!used.has(p)) used.set(p, new Set());
    used.get(p)!.add(n);
  };
  for (const [f, s] of src) {
    for (const m of s.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      const p = resolve(f, m[2]);
      if (!p) continue;
      for (const part of m[1].split(",")) {
        const n = part.replace(/\btype\s+/, "").split(/\s+as\s+/)[0].trim();
        if (n) add(p, n);
      }
    }
    for (const m of s.matchAll(/import\(["']([^"']+)["']\)\.then\(\(?m\)?\s*=>\s*m\.(\w+)/g)) {
      const p = resolve(f, m[1]);
      if (p) add(p, m[2]);
    }
  }
  return used;
}

function uncalled(): string[] {
  const used = importedNames();
  const out: string[] = [];
  for (const [f, s] of src) {
    if (!/^\s*["']use server["']/.test(s)) continue;
    for (const m of s.matchAll(/export async function (\w+)/g)) {
      const n = m[1];
      if (used.get(f)?.has(n)) continue;
      // Called from inside its own module.
      if ((s.match(new RegExp(`\\b${n}\\b`, "g")) ?? []).length > 1) continue;
      out.push(`${f}#${n}`);
    }
  }
  return out.sort();
}

describe("every server action has a caller", () => {
  it("finds none that nothing imports, beyond the named exceptions", () => {
    expect(uncalled().filter((k) => !(k in NO_CALLER_ON_PURPOSE))).toEqual([]);
  });

  it("keeps the exceptions honest in both directions", () => {
    const found = new Set(uncalled());
    for (const key of Object.keys(NO_CALLER_ON_PURPOSE)) expect(found.has(key), key).toBe(true);
  });
});
