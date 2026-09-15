import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The queue, and the properties that make it safe to run somebody's work
 * without them.
 *
 * `jobs` existed for two hundred and thirty-five migrations with zero rows,
 * because every module obeyed rule 7's *other* half and capped its own run —
 * and the cap became the office's job. The queue is what presses the button
 * again, so what has to be guarded is not that it is fast but that it is
 * **somebody's**:
 *
 *   - it runs as the person who queued it, which needs `SET ROLE`, which
 *     Postgres forbids inside a `SECURITY DEFINER` frame (`0240`);
 *   - `service_role` is not a member of `authenticated` (`0241`), so an Edge
 *     Function cannot be the worker and must not be given the tick;
 *   - the permission is a trigger, because a plain insert through PostgREST
 *     routes around any function (`0205`).
 *
 * Every assertion reads a file, so this runs without a database, and each was
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

/** Comments stripped, in both syntaxes — a guard that reads prose reports on it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

/**
 * The **latest** definition of a function. Migrations are immutable and
 * `create or replace` is how a function changes, so *"what does this do"* is
 * always a question about the highest-numbered file that defines it.
 */
function latestDefinition(name: string): string {
  const sql = code(migrationSql());
  const marker = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "g");
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

describe("a job runs as the person who asked for it", () => {
  /**
   * The load-bearing property, and the one somebody would "tidy" back: every
   * other function in the queue is definer, so an invoker one reads like an
   * oversight. Adding the two words compiles, applies, and fails at one minute
   * past the hour with `42501: cannot set parameter "role" within
   * security-definer function` — in a school, not in CI.
   */
  it("keeps the two functions that impersonate out of a definer frame", () => {
    for (const name of ["job_run_as_creator", "jobs_tick"]) {
      expect(
        header(latestDefinition(name)),
        `${name} must stay SECURITY INVOKER: Postgres refuses SET ROLE inside a definer frame`,
      ).not.toMatch(/security\s+definer/i);
    }
  });

  /** …and the bookkeeping half must stay definer: it writes rows nobody owns. */
  it("keeps the bookkeeping in a definer frame", () => {
    for (const name of ["job_record", "jobs_due", "jobs_reap"]) {
      expect(header(latestDefinition(name)), `${name} writes the queue itself`).toMatch(
        /security\s+definer/i,
      );
    }
  });

  /**
   * The impersonation is both halves or it is nothing: the claims alone leave
   * the caller as `postgres`, which carries `BYPASSRLS` and would run one
   * college's job over every college's rows; the role change alone leaves
   * `current_tenant_id()` null and the answer zero.
   */
  it("sets the claims and the role together, and puts both back", () => {
    const body = latestDefinition("job_run_as_creator");
    // The claims must be *written*, not merely mentioned. Asserting the string
    // passed on a plant that set some other setting and left the three reads of
    // `request.jwt.claims` — the saved copy and its two restores — in place.
    expect(body).toMatch(/set_config\(\s*'request\.jwt\.claims',\s*jsonb_build_object\(/);
    // …and with the college and the role on them, or RLS answers for nobody.
    expect(body).toContain("'tenant_id', v_job.tenant_id");
    expect(body).toMatch(/set\s+local\s+role\s+authenticated/);
    // Restored on the way out *and* in the exception handler — leaving the
    // session as `authenticated` would make the rest of the tick answer for a
    // person who is not there.
    expect((body.match(/reset role/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The authority is re-checked every attempt rather than remembered. A bursar
   * who left in March must not still be posting vouchers in June.
   */
  it("re-checks the creator and the permission on every attempt", () => {
    const body = latestDefinition("job_run_as_creator");
    expect(body).toContain("user_profiles");
    expect(body).toContain("role_permissions");
    expect(body).toContain("required_permission");
  });

  /**
   * A refusal is not a failure. A failure may be worth retrying; a refusal
   * means a person or a permission changed, and calls for something different.
   */
  it("tells a refusal apart from a failure", () => {
    const record = latestDefinition("job_record");
    // Anchored on the two branches, not on the two words. The first draft
    // asserted that `'refused'` appeared *somewhere* in the body — and passed
    // on a plant that read the flag and then wrote `'failed'` anyway, because
    // `p_outcome ->> 'refused'` still contained the string. That is this
    // codebase's own rule about guards: an assertion that a string appears
    // guards the string, not the mechanism.
    const refusal = record.slice(record.indexOf("if v_refused then"));
    const refusalBranch = refusal.slice(0, refusal.indexOf("end if;"));
    expect(refusalBranch).toMatch(/status\s*=\s*'refused'/);
    // And a refusal does not cost an attempt. Nothing about it will come right
    // on a retry: a person left, or a role lost a permission.
    expect(refusalBranch, "a refusal is not retried").not.toContain("attempts");

    const failure = record.slice(record.indexOf("if not v_ok then"));
    expect(failure.slice(0, failure.indexOf("end if;"))).toMatch(
      /attempts\s*=\s*jobs\.attempts \+ 1/,
    );
    expect(record).toMatch(/then 'failed' else 'queued' end/);
  });
});

describe("the permission is a trigger, not a function", () => {
  /**
   * `jobs` carries an INSERT policy, so a plain insert through PostgREST
   * reaches the table without passing through `job_enqueue` — `0205`'s lesson.
   * The permission therefore lives in a `BEFORE INSERT` trigger, and
   * `job_enqueue` is the door with the good manners rather than the gate.
   */
  it("checks the permission where a plain insert meets it", () => {
    const sql = code(migrationSql());
    expect(sql).toMatch(/create trigger jobs_check_enqueue\s+before insert on public\.jobs/);
    const check = latestDefinition("jobs_check_enqueue");
    expect(check).toContain("role_has_permission");
    // And the creator is stamped by the server, never accepted from the client:
    // everything the job later reads is read as this person.
    expect(check).toMatch(/created_by\s*:=\s*auth\.uid\(\)/);
  });

  /** One live job per kind per college, or two of them race for the same rows. */
  it("cannot have two live jobs of one kind", () => {
    const sql = code(migrationSql());
    expect(sql).toMatch(
      /create unique index[\s\S]{0,120}jobs_one_live_per_kind[\s\S]{0,200}where status in \('queued', 'processing'\)/,
    );
  });
});

describe("only one waker can do this", () => {
  const EDGE = join(ROOT, "supabase/functions");

  /**
   * `pg_has_role('service_role','authenticated','USAGE')` is **false**
   * (measured, `0241`), so an Edge Function cannot become a member of a college
   * and cannot run a job. Handing one the tick would not fail here — it would
   * fail every minute, in production, with an error naming a role.
   */
  it("never hands the tick to an Edge Function", () => {
    for (const dir of readdirSync(EDGE, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const file = join(EDGE, dir.name, "index.ts");
      let body: string;
      try {
        body = code(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      expect(body, `${dir.name} runs as service_role and cannot impersonate`).not.toContain(
        "jobs_tick",
      );
    }
  });

  it("wakes it from the database, where postgres is", () => {
    const sql = code(migrationSql());
    expect(sql).toMatch(/cron\.schedule\(\s*'schoolos_jobs_tick'/);
    const jobs = [...sql.matchAll(/cron\.schedule\([\s\S]*?\$job\$([\s\S]*?)\$job\$/g)].map(
      (m) => m[1],
    );
    expect(jobs.join("\n")).toContain("public.jobs_tick(");
  });

  /** And it refuses such a caller in words, not as a raw `42501`. */
  it("refuses a role that cannot impersonate, in a sentence", () => {
    const tick = latestDefinition("jobs_tick");
    expect(tick).toMatch(/pg_has_role\(\s*current_user\s*,\s*'authenticated'/);
    expect(tick).toContain("raise exception");
  });
});

describe("the module's own function is called unchanged", () => {
  /**
   * The point of impersonating rather than using `service_role` is that
   * `accounts_sync` and `invitation_apply` stay `SECURITY INVOKER` and RLS
   * keeps deciding the rows. Rewriting them as definers with hand-written
   * tenant filters would be reimplementing RLS once per kind.
   */
  it("leaves the bulk functions invoker", () => {
    for (const name of ["accounts_sync", "invitation_apply"]) {
      expect(header(latestDefinition(name)), `${name} must stay SECURITY INVOKER`).not.toMatch(
        /security\s+definer/i,
      );
    }
  });

  /** A page that leaves work behind goes back on the queue rather than reporting success. */
  it("re-queues a page that left work behind", () => {
    const record = latestDefinition("job_record");
    expect(record).toMatch(/case when v_remaining > 0 then 'queued' else 'completed' end/);
  });
});

describe("the screen", () => {
  const view = readFileSync(join(ROOT, "src/lib/validations/jobs.ts"), "utf8");

  /**
   * `fees-display.ts`'s rule: a display module that gains one runtime import
   * charges every route that renders a job badge for whatever it dragged in.
   * `Translator` comes in as a type, which erases.
   */
  it("keeps the display module free of value imports it does not need", () => {
    const valueImports = [...code(view).matchAll(/^import\s+(?!type\b)([\s\S]*?)from\s+"([^"]+)"/gm)]
      .map((m) => m[2])
      // `./labels` is the shared `labelFor`, which has no imports of its own —
      // the same thing every other display module in this codebase reaches for.
      .filter((from) => from !== "./labels");
    expect(valueImports, "a value import here reaches every route that renders a job").toEqual([]);
  });

  /**
   * The sentence that matters: a job which has done 200 of 250 and gone back on
   * the queue is **carrying on**, not "waiting". Saying "waiting" would put the
   * office back where they started, wondering whether to press something —
   * which is the defect the whole module exists to remove.
   */
  it("does not call a job that is carrying on 'waiting'", () => {
    expect(view).toContain("jobs.sentence.carryingOn");
    const fn = view.slice(view.indexOf("export function jobSentence"));
    expect(fn).toMatch(/progressDone\s*>\s*0/);
  });
});
