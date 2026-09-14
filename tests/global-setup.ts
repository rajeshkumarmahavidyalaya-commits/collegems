import { config } from "dotenv";
import { missingDatabaseEnv } from "./helpers/client";

/**
 * Say once, in the terminal, why half the suite is skipping.
 *
 * This is `globalSetup` and not `setupFiles` for a measured reason: a
 * `console.warn` in a setup file **never appears**. Vitest runs those inside the
 * worker and the default reporter does not surface their output, so the first
 * version of this warning was a string nobody rendered — the defect CLAUDE.md
 * names about the interface, arriving in the test harness. `globalSetup` runs
 * in the main process and its output is printed.
 *
 * Why it needs saying at all: without `.env.test.local` the database suites
 * skip, and **skipping is not passing**. The two that matter most —
 * `tenant-isolation` and `schema-invariants` — are the ones that make every
 * migration safe, so a green run without them is not a green run.
 */
export default function setup() {
  config({ path: ".env.test.local" });
  config({ path: ".env.local" });

  const missing = missingDatabaseEnv();
  if (missing.length === 0) return;

  const plural = missing.length === 1 ? "variable is" : "variables are";
  console.warn(
    [
      "",
      "  ┌─ The database-backed suites are SKIPPED ─────────────────────────",
      `  │  ${missing.length} ${plural} not set:`,
      ...missing.map((name) => `  │    ${name}`),
      "  │",
      "  │  Those suites prove tenant isolation and the schema invariants.",
      "  │  A green run without them is not a green run — see docs/testing.md.",
      "  └──────────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
}
