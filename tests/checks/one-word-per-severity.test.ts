import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Comments stripped, so each guard reads the code and not the prose about it. */
function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function ts(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function walk(dir: string, ext: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(p, ext, acc);
    } else if (ext.some((e) => entry.name.endsWith(e))) {
      acc.push(p);
    }
  }
  return acc;
}

/**
 * How bad a finding is, in one word, everywhere.
 *
 * `checks_run` returns `severity text` and twenty-two `*_problems()` functions
 * fill it in. **Nothing in Postgres constrains the word** — a set-returning
 * function cannot carry a CHECK, and migration `0101`'s usual answer (consult
 * the constraint) has nothing to consult. So the vocabulary is held by
 * convention, and convention is what this file replaces.
 *
 * Measured before `0266`:
 *
 * ```
 * warning  13 critics
 * info      9
 * error     8
 * warn      3   <- family_login_problems, scheduler_problems, job_problems
 * ```
 *
 * The three `warn`s were the three most recently written critics: typed once
 * and copied twice. And it mattered because six copies of `severityTone`
 * compared the word — `severity === "warning" ? "warning" : "secondary"` — so
 * a `warn` was drawn in the same grey as an `info`. Live, the row carrying it
 * was *"302 of 302 active students have nobody who can sign in"*.
 *
 * Both halves are guarded here: the word the database emits, and the number of
 * places that decide what it means.
 */
const VOCABULARY = ["error", "warning", "info"];

/** Words a critic could plausibly reach for, and which this product does not use. */
const NEAR_MISSES = ["warn", "critical", "fatal", "notice", "danger", "severe"];

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * The **latest** definition of every `*_problems()` function. Migrations are
 * immutable and `create or replace` is how one changes, so the question is
 * always about the highest-numbered file that defines it — a sweep over every
 * definition answers it by filename accident and would still be reporting the
 * three this fixed.
 */
function latestCritics(): Map<string, { file: string; body: string }> {
  const latest = new Map<string, { file: string; body: string }>();
  for (const file of migrationFiles()) {
    const src = sql(readFileSync(join(MIGRATIONS, file), "utf8"));
    const pattern = /create (?:or replace )?function public\.(\w*problems)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
      const rest = src.slice(match.index);
      const end = rest.indexOf("\n$$;");
      latest.set(match[1], { file, body: end === -1 ? rest : rest.slice(0, end) });
    }
  }
  return latest;
}

describe("one word per severity", () => {
  const critics = latestCritics();

  it("finds the critics at all", () => {
    // A guard reading an empty set passes on nothing.
    expect(critics.size).toBeGreaterThan(15);
  });

  it.each([...critics.keys()].sort())("%s emits only the vocabulary", (name) => {
    const { file, body } = critics.get(name)!;
    // Anchored on the near-misses rather than on "every quoted string", because
    // these bodies are full of quoted words that are not severities — a
    // `state`, a `status`, a kind, and whole English sentences.
    const found = NEAR_MISSES.filter((word) =>
      new RegExp(`'${word}'(?!\\w)`).test(body),
    );
    expect(found, `${name} (${file}) emits ${found.join(", ")}`).toEqual([]);
  });

  it("every word the critics do emit is one this product renders", () => {
    // The other direction: a critic inventing a *new* word rather than
    // misspelling an old one. Only severity-shaped literals are considered,
    // which is why the list is the union over all critics rather than a
    // per-body parse.
    const emitted = new Set<string>();
    for (const { body } of critics.values()) {
      for (const m of body.matchAll(/'(error|warning|info)'/g)) emitted.add(m[1]);
    }
    for (const word of emitted) expect(VOCABULARY).toContain(word);
  });
});

/**
 * And the half the database cannot guard: how many places decide what the word
 * means.
 *
 * `severityTone` was **six copies under one name** — `formatMoney`'s shape
 * (rule 15) with a consequence, since three of them had no `error` branch at
 * all and would have drawn a critic's error in the warning colour the day one
 * of their critics grew one. The vocabulary itself was written down twice, and
 * the conservative default (`.catch("warning")`) exactly once.
 */
describe("one definition of what a severity means", () => {
  const files = walk(SRC, [".ts", ".tsx"]).map((path) => ({
    path: relative(ROOT, path),
    body: ts(readFileSync(path, "utf8")),
  }));

  it.each([
    ["severityTone", /export function severityTone\b/],
    ["severityLabel", /export function severityLabel\b/],
    ["PROBLEM_SEVERITIES", /export const PROBLEM_SEVERITIES\b/],
    ["SEVERITY_LABEL", /export const SEVERITY_LABEL\b/],
  ])("%s is defined once", (_name, pattern) => {
    // `export { x } from "./severity"` is a re-export, not a definition, and is
    // deliberately allowed: a module may keep the name its callers know while
    // there is still one body.
    const definers = files.filter((f) => pattern.test(f.body)).map((f) => f.path);
    expect(definers).toEqual(["src/lib/validations/severity.ts"]);
  });

  it("the unrecognised word is loud, not quiet", () => {
    // The decision `certificates.ts` had already made with `.catch("warning")`
    // and five renderers never found. Asserted on the behaviour rather than on
    // the source: a finding this product cannot classify is one somebody should
    // look at, and guessing the other way is a row nobody reads.
    const body = readFileSync(join(SRC, "lib", "validations", "severity.ts"), "utf8");
    expect(body).toContain('if (severity === "info") return "secondary"');
    expect(body).toMatch(/return "warning";\s*\n\}/);
  });
});
