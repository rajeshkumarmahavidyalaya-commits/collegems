import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Whose authority does a scheduled report run under?
 *
 * The three message kinds need none: *"tell this child's family they were
 * absent"* is a fact about a row, and `schedules_tick` is `SECURITY DEFINER`
 * because nobody is holding a JWT at half past seven. A **report** is not like
 * that — `report_run` gates on `role_permissions` for `current_role_code()`,
 * so running one means *being somebody*.
 *
 * `0238` decided that somebody is `schedules.created_by`. `0240` found that the
 * mechanism it had used was impossible:
 *
 * > **Postgres forbids `SET ROLE` anywhere inside a `SECURITY DEFINER` frame.**
 *
 * and `0241` found the fact that shapes the rest of it:
 *
 * > **`service_role` is not a member of `authenticated`.** So the Edge Function
 * > cannot run a report as anybody, and the digest tick has exactly one waker.
 *
 * Every assertion here reads a file, so this runs without a database. Each was
 * verified by planting the violation.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/** Comments stripped, so a guard that reads prose reports on the schema. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

/**
 * The **latest** definition of a function.
 *
 * Migrations are immutable and `create or replace` is how a function changes,
 * so *"what does this do"* is always a question about the highest-numbered file
 * that defines it. `schedule_report_digest` is defined three times — `0238`
 * definer, `0240` invoker, `0241` invoker again — and a sweep over every
 * definition would answer by filename accident.
 *
 * Both spellings are matched: `0240` deliberately used a bare `create function`
 * after a `drop`, because turning a definer into an invoker with
 * `create or replace` is exactly the edit that is invisible in a diff.
 */
function latestDefinition(name: string): string {
  const sql = code(migrationSql());
  const marker = new RegExp(`create (?:or replace )?function public\\.${name.replace(/\./g, "\\.")}\\(`, "g");
  const starts = [...sql.matchAll(marker)].map((m) => m.index ?? -1);
  expect(starts.length, `no migration defines public.${name}`).toBeGreaterThan(0);
  const start = starts[starts.length - 1];
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end === -1 ? undefined : end);
}

/** The declaration — everything before the body — where `security definer` lives. */
function header(body: string): string {
  const at = body.indexOf("as $$");
  return at === -1 ? body : body.slice(0, at);
}

describe("a definer may not become somebody else", () => {
  /**
   * The load-bearing property, and the one somebody would "tidy" back.
   *
   * Every other function in the scheduler is definer, so an invoker one reads
   * like an oversight. Adding the two words compiles, applies, and fails at
   * seven the next morning with `42501: cannot set parameter "role" within
   * security-definer function` — in a school, not in CI.
   */
  it("keeps the two functions that impersonate out of a definer frame", () => {
    for (const name of ["schedule_report_digest", "schedule_digests_tick"]) {
      expect(
        header(latestDefinition(name)),
        `${name} must stay SECURITY INVOKER: Postgres refuses SET ROLE inside a definer frame`,
      ).not.toMatch(/security\s+definer/i);
    }
  });

  /**
   * …and the definer half must not call them.
   *
   * `schedule_run` writes `schedule_runs` for a tenant nobody is signed in to,
   * so it has to be definer. `0239` had it calling `schedule_report_digest`
   * directly, which is the same error one frame up: the answer now arrives as a
   * parameter, computed by the invoker tick before the claim.
   */
  it("does not call the impersonating function from the definer one", () => {
    const run = latestDefinition("schedule_run");
    expect(header(run), "schedule_run writes for an absent tenant and stays definer").toMatch(
      /security\s+definer/i,
    );
    expect(
      run,
      "schedule_run must take the digest as a parameter, never compute it: it cannot SET ROLE",
    ).not.toContain("schedule_report_digest(");
    expect(run, "the precomputed answer arrives as p_digest").toContain("p_digest");
  });
});

describe("two ticks, one list", () => {
  /**
   * `schedule_runs` is unique on `(schedule_id, occurrence_at)` and the run
   * opens with `on conflict do nothing`, so **whichever tick reaches an
   * occurrence first owns it**. Two hand-written kind lists are two answers,
   * and the day they disagree one tick claims work the other was going to do.
   */
  it("divides the kinds out of one definition and not by hand", () => {
    const tick = latestDefinition("schedules_tick");
    const digests = latestDefinition("schedule_digests_tick");

    expect(tick).toContain("schedule_kinds_needing_authority()");
    expect(digests).toContain("schedule_kinds_needing_authority()");

    // The kind appears in exactly one place in the schema's filtering: the list.
    for (const [name, body] of [
      ["schedules_tick", tick],
      ["schedule_digests_tick", digests],
    ] as const) {
      expect(
        body,
        `${name} must ask schedule_kinds_needing_authority(), never name the kind itself`,
      ).not.toContain("'report.digest'");
    }

    const list = latestDefinition("schedule_kinds_needing_authority");
    expect(list).toContain("'report.digest'");
  });

  /**
   * The two filters are shaped differently on purpose, and the asymmetry is the
   * point: the digest tick names what it **takes**, the message tick names only
   * what it **leaves**. A kind added to the CHECK next year is therefore picked
   * up by the message tick, where an unimplemented kind raises by name into a
   * `failed` run somebody can read — rather than being run by neither.
   */
  it("takes only those, and leaves only those", () => {
    // schedules_due(p_limit, p_only_kinds, p_except_kinds)
    expect(latestDefinition("schedules_tick")).toMatch(
      /schedules_due\(\s*v_limit\s*,\s*null\s*,\s*v_except\s*\)/,
    );
    expect(latestDefinition("schedule_digests_tick")).toMatch(
      /schedules_due\(\s*v_limit\s*,\s*v_only\s*,\s*null\s*\)/,
    );
  });
});

describe("only one waker can do this", () => {
  const EDGE = join(ROOT, "supabase/functions/schedule-tick/index.ts");

  /**
   * The other half of `waker.test.ts`'s rule.
   *
   * That one asserts the cron wakes everything the Edge Function wakes, which
   * is the direction that matters and still holds. The reverse is now
   * **deliberately false**: `pg_has_role('service_role','authenticated','USAGE')`
   * is false, so the Edge Function cannot `SET ROLE` and must never be handed
   * this RPC. Giving it one would not fail here — it would fail every morning,
   * at a school, with an error naming a role rather than a report.
   */
  it("never hands the digest tick to the Edge Function", () => {
    const edge = code(readFileSync(EDGE, "utf8"));
    expect(
      edge,
      "service_role is not a member of authenticated: this RPC would fail every run",
    ).not.toContain("schedule_digests_tick");
  });

  it("wakes it from the database, where postgres is", () => {
    const sql = code(migrationSql());
    expect(sql).toMatch(/cron\.schedule\(\s*'schoolos_schedule_digests_tick'/);
    const jobs = [...sql.matchAll(/cron\.schedule\([\s\S]*?\$job\$([\s\S]*?)\$job\$/g)].map(
      (m) => m[1],
    );
    expect(jobs.join("\n")).toContain("public.schedule_digests_tick(");
  });

  /**
   * And it says so rather than failing obscurely. A role that cannot become a
   * member of the college is refused in a sentence at the top of the tick, not
   * as `42501: permission denied to set role` from inside a report.
   */
  it("refuses a role that cannot impersonate, in words", () => {
    const digests = latestDefinition("schedule_digests_tick");
    expect(digests).toMatch(/pg_has_role\(\s*current_user\s*,\s*'authenticated'/);
    expect(digests).toContain("raise exception");
  });
});
