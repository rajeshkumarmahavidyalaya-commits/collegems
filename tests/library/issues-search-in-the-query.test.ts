import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Books Issued search filtered the 25 rows already read, in TypeScript, so
 * a title on page 2 could not be found from page 1 and the total stayed the
 * unfiltered one. Since 0338 it runs in Postgres (`library_issues_matching`)
 * and the page is taken from what matched. Read from the source, because a
 * server action calls `cookies()` and cannot run outside a request.
 */
const src = readFileSync(join(process.cwd(), "src/app/(app)/library/actions.ts"), "utf8");
const body = (() => {
  const start = src.indexOf("export async function listIssues");
  const end = src.indexOf("\nexport ", start + 1);
  return src.slice(start, end).replace(/\/\/.*$/gm, "");
})();

describe("the Books Issued search runs in the query", () => {
  it("reads through library_issues_matching with the term as a parameter", () => {
    expect(body).toMatch(/\.rpc\(\s*"library_issues_matching",\s*\{\s*p_query:\s*search/);
  });

  it("does not filter the page it already read by the term", () => {
    expect(body).not.toMatch(/rows\s*=\s*rows\.filter/);
    expect(body).not.toMatch(/needle/);
  });

  it("pages after the search, with a tiebreak", () => {
    const rpc = body.indexOf("library_issues_matching");
    const range = body.indexOf(".range(");
    expect(rpc).toBeGreaterThan(-1);
    expect(range).toBeGreaterThan(rpc);
    expect(body).toMatch(/\.order\("id"/);
  });
});
