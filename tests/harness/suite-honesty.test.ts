import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingDatabaseEnv } from "../helpers/client";

/**
 * The test suite, tested.
 *
 * 48 of the 97 test files need two admin logins in two different tenants, and
 * before this they **failed** without them — `requireEnv` throws, so `npm test`
 * was red on every clean checkout and a real regression was indistinguishable
 * from a missing password. That is this codebase's own rule turned on its own
 * suite: *a check that can never go green is a check people learn to ignore.*
 *
 * They skip now. The danger of skipping is the opposite one — a suite that is
 * quietly absent reads as a suite that passed — so two things guard it: a
 * banner naming the missing variables (`tests/global-setup.ts`), and this file,
 * which fails when a new database suite forgets to declare itself.
 */

const ROOT = process.cwd();
const TESTS = join(ROOT, "tests");

function testFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) testFiles(p, acc);
    else if (entry.name.endsWith(".test.ts")) acc.push(p);
  }
  return acc;
}

/** Comments stripped, so the guard reads the code rather than the prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

describe("a suite that needs the database says so", () => {
  it("uses describeDb wherever it signs in", () => {
    const offenders: string[] = [];

    for (const file of testFiles(TESTS)) {
      const body = code(readFileSync(file, "utf8"));
      if (!body.includes("helpers/client")) continue;
      // This file imports the helper to assert *about* it, and runs anywhere.
      if (file.endsWith("suite-honesty.test.ts")) continue;

      // A top-level `describe(` in a file that signs in is a suite that will
      // fail rather than skip on a checkout with no credentials.
      if (/^describe\(/m.test(body)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }

    expect(
      offenders,
      "a suite that reaches the database must use describeDb, or it fails red " +
        "on every machine without .env.test.local",
    ).toEqual([]);
  });

  it("decides at call time, not at import time", () => {
    /**
     * `describeDb` is a function and not a `const`, and that is load-bearing:
     * `tests/setup.ts` imports this module to warn about missing variables, so
     * a `const` initialiser would run **before** `config()` had loaded
     * `.env.test.local`, and every database suite would skip even on a machine
     * that has the credentials. Written wrong first; caught here.
     */
    const helper = code(readFileSync(join(TESTS, "helpers/client.ts"), "utf8"));
    expect(helper).toMatch(/export function describeDb\(/);
    expect(helper, "a const would be evaluated before dotenv runs").not.toMatch(
      /export const describeDb/,
    );
  });

  it("prints the warning from the main process, where it is visible", () => {
    // A `console.warn` in a `setupFiles` module is never surfaced by the
    // reporter — measured, not assumed. The banner lives in globalSetup.
    const config = code(readFileSync(join(ROOT, "vitest.config.ts"), "utf8"));
    expect(config).toContain("globalSetup");

    const setup = code(readFileSync(join(TESTS, "setup.ts"), "utf8"));
    expect(setup, "a warning here would never be printed").not.toContain("console.");

    const globalSetup = code(readFileSync(join(TESTS, "global-setup.ts"), "utf8"));
    expect(globalSetup).toContain("console.warn");
    expect(globalSetup).toContain("missingDatabaseEnv");
  });

  it("names every variable it needs, so the banner cannot go stale", () => {
    // If a new credential is added to `signedInClient` without being added to
    // DATABASE_ENV, the suite would run and fail rather than skip.
    const helper = code(readFileSync(join(TESTS, "helpers/client.ts"), "utf8"));

    const declared = (helper.match(/const DATABASE_ENV = \[[\s\S]*?\]/)?.[0] ?? "").match(
      /"([A-Z_]+)"/g,
    );
    expect(declared, "DATABASE_ENV was renamed or reshaped").not.toBe(null);
    const names = declared!.map((q) => q.slice(1, -1));

    // Two shapes, and the first draft only caught one: `requireEnv("LITERAL")`
    // finds the project URL and key, while the four tenant variables are passed
    // *as arguments* to `signedInClient`, so removing one from DATABASE_ENV
    // went unnoticed. A guard that misses the values that actually go stale is
    // a guard for the two that never do.
    const required = [
      ...[...helper.matchAll(/requireEnv\("([A-Z_]+)"\)/g)].map((m) => m[1]),
      ...[...helper.matchAll(/signedInClient\(\s*"([A-Z_]+)",\s*"([A-Z_]+)"/g)].flatMap((m) => [
        m[1],
        m[2],
      ]),
    ];

    expect(required.length, "no environment variables were found at all").toBeGreaterThan(3);
    for (const name of required) {
      expect(names, `${name} is required but not in DATABASE_ENV`).toContain(name);
    }
  });

  it("agrees with itself about whether the database is reachable", () => {
    // The two halves must not disagree: anything reported missing must really
    // be absent from the environment.
    const missing = missingDatabaseEnv();
    expect(Array.isArray(missing)).toBe(true);
    for (const name of missing) expect(process.env[name]).toBeFalsy();
  });
});
