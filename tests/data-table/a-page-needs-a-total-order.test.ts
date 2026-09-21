import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/** Comments stripped, so the guard reads the code and not the prose. */
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
 * Columns that are a total order on their own, so one `.order()` is enough.
 *
 * The bar is **a unique index or a gapless serial**, verified against the live
 * schema, never "it looks distinct in today's data". `admission_number` is
 * 303 of 303 distinct on this college and `membership_number` 75 of 75 — but
 * `status` is **1 of 303**, which is the same table and the same kind of
 * eyeball.
 */
const UNIQUE_BY_ITSELF = new Map<string, string>([
  [
    "membership_number",
    "Unique per tenant on public.members; 75 of 75 distinct on this college.",
  ],
]);

/**
 * A paged list must be ordered by something total, or the page is arbitrary.
 *
 * `limit`/`offset` over a non-total order lets Postgres return any arrangement
 * of a tied group, and it need not pick the same one twice — so page 2 can
 * repeat a row from page 1 and silently drop another. Rule 7 already wrote
 * this down for **exports** (*"an export could contain one row twice and miss
 * another"*) and the DataTable pages exactly the same way.
 *
 * Measured across the six paged lists in this app, which is what makes it a
 * defect rather than a theory:
 *
 * | list | sorted by | rows | distinct | tied |
 * |---|---|---|---|---|
 * | `/fees` balances | `full_name` *(the default)* | 302 | 102 | **200** |
 * | `/fees` balances | `charged` | 302 | 12 | **290** |
 * | `/students` | `status` | 303 | **1** | **302** |
 * | `/library/books` | `total_copies` | 21 | 5 | **16** |
 * | `/library/issues` | `issued_at` | 26 | 4 | **22** |
 * | `/fees/invoices` | `issue_date, invoice_number` | 317 | 317 | 0 |
 * | `/library/members` | `membership_number` | 75 | 75 | 0 |
 *
 * The last two already carried the fix, and the invoice list carries it
 * *deliberately* — somebody appended `invoice_number` to a tying `issue_date`.
 * **One list doing it right is not a rule until something checks the others.**
 */
describe("a paged list is ordered by something total", () => {
  const sites = sourceFiles(SRC).flatMap((path) => {
    const body = code(readFileSync(path, "utf8"));
    return [...body.matchAll(/\.range\(/g)].map((m) => {
      // The chain this `.range()` belongs to: back to the end of the previous
      // statement. Every `.order()` in this codebase is chained immediately
      // before its `.range()`, so the slice holds all of them.
      const start = body.lastIndexOf(";", m.index) + 1;
      const chain = body.slice(start, m.index);
      return {
        path: relative(ROOT, path),
        line: body.slice(0, m.index).split("\n").length,
        columns: [...chain.matchAll(/\.order\(\s*([^,)\s]+)/g)].map((o) =>
          o[1].replace(/^["'`]|["'`]$/g, ""),
        ),
      };
    });
  });

  it("finds every paged query", () => {
    // A floor, not a fixture: if somebody adds a paged list this number goes
    // up and the checks below cover it. It exists so that a refactor which
    // makes the matcher find *nothing* fails loudly instead of passing.
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it("gives each one a tiebreak, or names a column that needs none", () => {
    const arbitrary = sites.filter((s) => {
      if (s.columns.length === 0) return true;
      if (s.columns.length > 1) return false;
      return !UNIQUE_BY_ITSELF.has(s.columns[0]);
    });

    expect(
      arbitrary.map((s) => `${s.path}:${s.line} ordered by [${s.columns.join(", ")}]`),
      "A .range() over a non-total order returns an arbitrary slice of each " +
        "tied group, so a page can repeat a row and skip another. Chain a " +
        "second .order() on a unique column, or — if the single column really " +
        "is unique in the schema — name it in UNIQUE_BY_ITSELF with the " +
        "evidence.",
    ).toEqual([]);
  });

  it("keeps UNIQUE_BY_ITSELF from rotting", () => {
    // An allowlist read in one direction is a line explaining a decision
    // nobody is making any more.
    const used = new Set(sites.filter((s) => s.columns.length === 1).map((s) => s.columns[0]));
    const stale = [...UNIQUE_BY_ITSELF.keys()].filter((c) => !used.has(c));
    expect(stale, "UNIQUE_BY_ITSELF names a column no single-order page uses.").toEqual([]);
  });
});
