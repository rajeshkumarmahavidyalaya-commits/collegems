import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scheduler's waker.
 *
 * `schedule_runs` was empty for a hundred and twenty migrations. Not a bug in
 * the module: **nothing was calling it.** No `vercel.json`, no
 * `supabase/config.toml`, no cron entry anywhere, and `pg_cron` not installed.
 * `schedule-tick`'s own header says its whole job is *"the one thing Postgres
 * cannot do: be woken up"*, and nothing woke it.
 *
 * Every assertion here reads a file, so this runs without a database.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const EDGE = join(ROOT, "supabase/functions/schedule-tick/index.ts");

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/** Comments stripped, in both syntaxes — a guard that reads prose reports on it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function sourceFiles(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      sourceFiles(p, exts, acc);
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      acc.push(p);
    }
  }
  return acc;
}

describe("something wakes the scheduler", () => {
  it("schedules the tick in the database", () => {
    const sql = code(migrationSql());
    expect(sql).toContain("create extension if not exists pg_cron");
    expect(sql).toMatch(/cron\.schedule\(\s*'schoolos_schedules_tick'/);
  });

  /**
   * The assertion worth having.
   *
   * There are two wakers on purpose — pg_cron here, and the Edge Function for
   * any deployment that is not Supabase — and two wakers are two places to add
   * the next periodic job. If somebody gives `schedule-tick` a fourth RPC and
   * not the cron, a Supabase deployment silently stops doing it, with no
   * register of the omission anywhere. CLAUDE.md's question, asked of a
   * schedule: **who else does this?**
   */
  it("wakes everything the Edge Function wakes", () => {
    const edge = code(readFileSync(EDGE, "utf8"));
    const edgeCalls = [...edge.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(edgeCalls.length, "the Edge Function's RPC calls were not found").toBeGreaterThan(0);

    const sql = code(migrationSql());
    const cronCommands = [...sql.matchAll(/cron\.schedule\([\s\S]*?\$job\$([\s\S]*?)\$job\$/g)].map(
      (m) => m[1],
    );
    expect(cronCommands.length, "no cron jobs were found").toBeGreaterThan(0);
    const cronText = cronCommands.join("\n");

    const missed = edgeCalls.filter((name) => !cronText.includes(`public.${name}(`));
    expect(
      missed,
      "these run on a non-Supabase deployment and never on this one — add them to the cron too",
    ).toEqual([]);
  });

  /**
   * An in-database job is one supported answer and not the only one, so its
   * absence is information rather than a fault. A critic that fires on a
   * correctly-configured external waker is one people learn to ignore — the bar
   * CLAUDE.md sets is *"is somebody going to have to do something about it"*.
   */
  it("does not accuse a deployment whose waker is outside the database", () => {
    const sql = code(migrationSql());
    const start = sql.lastIndexOf("create or replace function public.scheduler_problems(");
    expect(start, "scheduler_problems is not defined").toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", start));

    const noWaker = body.slice(body.indexOf("'scheduler.no_waker'"));
    expect(noWaker.slice(0, 200)).toContain("'info'");
    expect(noWaker.slice(0, 200)).not.toContain("'warn'");
  });

  /**
   * Rule 6, at the scheduler. `schedules_tick` is revoked from everybody
   * holding a JWT, so an HTTP waker must carry the service-role key — and the
   * shortest path to a cron is a Next route with that key in its environment.
   * In the database there is no key at all: the job runs as `postgres`, which
   * is the authority those definer functions already require.
   */
  it("keeps the service-role key out of the Next app", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"), [".ts", ".tsx"])) {
      const body = code(readFileSync(file, "utf8"));
      if (/SERVICE_ROLE|service_role/.test(body)) offenders.push(file.slice(ROOT.length + 1));
    }
    expect(offenders, "secrets never enter the Next.js app (rule 6)").toEqual([]);
  });
});
