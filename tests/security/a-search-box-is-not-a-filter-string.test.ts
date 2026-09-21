import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/**
 * Comments stripped, so the guard reads the code and not the prose.
 *
 * This is the reason it has to be: the first version of this check, written in
 * `tests/students/guardians.test.ts`, **failed on the doc comment explaining
 * why `.or(` had been replaced.** A comment can hide a violation and fake one,
 * and a guard that reads TypeScript needs both comment syntaxes.
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
 * `.or(...)` on a Supabase query takes a **PostgREST filter language**, and a
 * search term spliced into it is a query built out of somebody's typing. A
 * guardian searched for as `O'Brien, R` closes the group early; a book called
 * `Gödel, Escher, Bach` cannot be found by its own title.
 *
 * It is **not** a way into another tenant's rows — RLS is unmoved by any of it
 * — and it is not SQL injection. It is a search box that breaks on a comma,
 * which a school meets in its first week.
 *
 * Migration `0223` fixed one site and wrote the rule down: *the fix is not to
 * escape more carefully, it is to stop building a query out of text.* It then
 * guarded **one module**, and eight more sites went on doing it for thirty-six
 * migrations — three in the command palette, four in a student picker written
 * four times over, one in the library list.
 *
 * > **A rule guarded in the module that discovered it is a rule that holds in
 * > that module.** The sweep is the guard.
 *
 * Deliberate exceptions carry their reason. The bar is *the argument is not
 * text a person typed*, never *we have not got round to it*.
 */
const NOT_A_SEARCH_TERM = new Map<string, string>([
  [
    "src/app/(app)/homework/actions.ts",
    "`.or(filters.join(\",\"))` is two `in.(…)` lists of uuids this server read " +
      "back from the database a moment earlier — no part of it is typed by anybody. " +
      "It stays a filter string because the alternative is two round trips to " +
      "render a paperclip.",
  ],
]);

describe("a search box is not a filter string", () => {
  const files = sourceFiles(SRC).map((path) => ({
    path: relative(ROOT, path),
    body: code(readFileSync(path, "utf8")),
  }));

  /**
   * Zod's `.or()` is a different method with the same name —
   * `z.string().or(z.literal(""))` builds a union and reaches no database, and
   * this codebase has one. Two things tell them apart, and the **first** is the
   * load-bearing one:
   *
   * - a file that never builds a Supabase query cannot be making a PostgREST
   *   call, whatever it names its methods;
   * - and inside one that does, an argument beginning `z.` is a schema.
   *
   * The first draft had only the second, and a validations module that imported
   * zod under an alias was reported as a defect. **A guard that reports a
   * correct file is a guard somebody switches off** — so the discriminator is
   * what the file *does*, not how it spells an identifier.
   */
  function queryOrCalls(file: { path: string; body: string }): string[] {
    const queriesTheDatabase =
      /\bsupabase\s*[.)]/.test(file.body) || /createClient\s*\(/.test(file.body);
    if (!queriesTheDatabase) return [];
    return [...file.body.matchAll(/\.or\(\s*([^\n]{0,40})/g)]
      .map((m) => m[1].trim())
      .filter((arg) => !arg.startsWith("z."));
  }

  it("builds no PostgREST filter out of interpolated text", () => {
    const offenders = files
      .map((f) => ({ path: f.path, calls: queryOrCalls(f) }))
      .filter((f) => f.calls.length > 0 && !NOT_A_SEARCH_TERM.has(f.path));

    expect(
      offenders.map((o) => `${o.path}: .or(${o.calls[0]}…`),
      "`.or()` takes a PostgREST filter language. A term spliced into it breaks " +
        "on a comma and on an apostrophe. Use an RPC with a bound parameter — " +
        "guardian_search, global_search and student_search are the three that " +
        "exist — or name the file in NOT_A_SEARCH_TERM with the reason its " +
        "argument is not something a person typed.",
    ).toEqual([]);
  });

  it("keeps every allowlisted file honest about still being one", () => {
    // An allowlist read in one direction rots: a file whose `.or(` was removed
    // leaves a line explaining a decision nobody is making.
    const stale = [...NOT_A_SEARCH_TERM.keys()].filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || queryOrCalls(file).length === 0;
    });
    expect(stale, "NOT_A_SEARCH_TERM names a file that no longer calls .or().").toEqual([]);
  });

  /**
   * The three bound-parameter functions are what a new search is meant to copy,
   * so the shape is pinned rather than left to a reader of this comment: the
   * term reaches `ilike` through `||`, which is string concatenation *inside
   * SQL*, where `p_query` is a value and not syntax.
   *
   * Anchored on each function's own body. The first draft concatenated every
   * migration and asserted the shape appeared *somewhere*, which three
   * functions satisfy between them while any one of them changes freely —
   * this repository's recurring guard defect: **an assertion that a string
   * appears somewhere guards the string, not the mechanism.**
   */
  it("pins the shape the RPCs use instead", () => {
    const dir = join(ROOT, "supabase/migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");

    for (const fn of ["guardian_search", "global_search", "student_search"]) {
      // `create or replace` is how a function changes, so the *latest*
      // definition is the one that runs.
      const marker = `create or replace function public.${fn}(`;
      const start = sql.lastIndexOf(marker);
      expect(start, `${fn} should be defined in a migration`).toBeGreaterThan(-1);
      const body = sql.slice(start, sql.indexOf("$$;", start));
      expect(body, `${fn} should take its term as a bound parameter`).toContain(
        "ilike '%' || btrim(p_query) || '%'",
      );
      expect(body, `${fn} should not splice the term into an identifier`).not.toMatch(
        /execute\s+/i,
      );
    }
  });
});
