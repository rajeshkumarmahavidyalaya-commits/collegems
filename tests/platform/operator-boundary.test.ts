import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The operator boundary, guarded by reading the schema rather than by trusting
 * it.
 *
 * A platform operator reads across colleges, which is the one thing rule 1
 * exists to make impossible. The design's answer is that an operator **belongs
 * to no tenant** — so `current_tenant_id()` is null for them and every RLS
 * policy in `public` already refuses them every row — and their entire reach is
 * a handful of `SECURITY DEFINER` functions that check
 * `platform.require_operator()` and log the look.
 *
 * Probed live, as a signed-in operator: **0** students, **0** people, **0**
 * ledger entries, **0** subscriptions, and `permission denied for schema
 * platform` on a direct read. As a college principal: refused by both operator
 * functions.
 *
 * That property is only true while three things stay true in the source, and
 * those are what this file checks. It needs no database, because the rule must
 * be enforceable everywhere.
 */

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

function sources(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));
}

function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

describe("a platform operator belongs to no college", () => {
  it("never grants a signed-in role access to the platform schema", () => {
    // The schema is reachable only through definer functions. A `grant ... on
    // schema platform to authenticated` — or on any table in it — would turn
    // the operator tables into ordinary readable data and make the definer
    // wrapper decorative.
    const offenders: string[] = [];

    for (const { file, sql } of sources()) {
      const code = withoutComments(sql);
      for (const match of code.matchAll(/grant[\s\S]*?;/gi)) {
        const stmt = match[0].replace(/\s+/g, " ");
        const touchesPlatform = /\bplatform\b/i.test(stmt);
        const toSignedIn = /\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(stmt);
        // Granting EXECUTE on a `public.platform_*` function is exactly how the
        // console is reached, and is not what this guards against.
        const isPublicWrapper = /grant\s+execute\s+on\s+function\s+public\.platform_/i.test(stmt);
        if (touchesPlatform && toSignedIn && !isPublicWrapper) {
          offenders.push(`${file}: ${stmt.slice(0, 140)}`);
        }
      }
    }

    expect(
      offenders,
      "The platform schema must stay unreachable except through definer " +
        "functions. Granting it to a signed-in role removes the only thing " +
        "standing between an operator session and the operator tables.",
    ).toEqual([]);
  });

  it("never lets an operator check leak into a policy on public", () => {
    // The tempting shortcut: `or platform.current_operator() is not null` added
    // to a policy so an operator "can just see it". That would hand them every
    // row of that table in every college, which is precisely what metadata-only
    // was chosen to avoid — and it would do it invisibly, since the policy still
    // reads as if it were tenant-scoped.
    const offenders: string[] = [];

    for (const { file, sql } of sources()) {
      const code = withoutComments(sql);
      for (const match of code.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (/platform\.|current_operator|is_operator/i.test(match[0])) {
          offenders.push(`${file}: ${match[0].slice(0, 140).replace(/\s+/g, " ")}`);
        }
      }
    }

    expect(
      offenders,
      "An operator must never be reachable from an RLS policy. Their access is " +
        "the definer functions, which return metadata only and log every look.",
    ).toEqual([]);
  });

  it("every operator-facing function checks it is an operator asking", () => {
    // A `public.platform_*` function granted to `authenticated` and NOT calling
    // require_operator() would be readable by every signed-in person on the
    // deployment. `platform_am_i_an_operator` and `platform_slug_available` are
    // the deliberate exceptions: each answers a question about the caller alone.
    const SELF_ONLY = ["platform_am_i_an_operator", "platform_slug_available", "platform_start_school"];
    const offenders: string[] = [];

    for (const { file, sql } of sources()) {
      const code = withoutComments(sql);
      for (const match of code.matchAll(
        /create\s+or\s+replace\s+function\s+public\.(platform_\w+)[\s\S]*?\$\$;/gi,
      )) {
        const name = match[1];
        if (SELF_ONLY.includes(name)) continue;
        if (!/require_operator\s*\(/i.test(match[0])) {
          offenders.push(`${file}: public.${name} does not call platform.require_operator()`);
        }
      }
    }

    expect(
      offenders,
      "A public.platform_* function reachable by `authenticated` must check " +
        "require_operator(), which both refuses non-operators and writes the " +
        "access-log row. Without it the function is open to every session.",
    ).toEqual([]);
  });

  it("the access log is append-only by revoke, not by an absent policy", () => {
    // Rule 6's two shapes, and this table wants the stronger one: it is the
    // record of what the platform's own staff did, so a write should RAISE
    // rather than silently match nothing.
    //
    // Comments are stripped first, and that is not fussiness: the first draft of
    // this check read the raw SQL, so commenting the revoke out left it green.
    // A guard that a `--` disarms is a guard that reports on the prose rather
    // than on the schema.
    const declaring = sources()
      .map(({ file, sql }) => ({ file, sql: withoutComments(sql) }))
      .find(({ sql }) => /create table if not exists platform\.access_log/i.test(sql));
    expect(declaring, "the migration declaring platform.access_log should still exist").toBeDefined();

    expect(
      /revoke\s+update,\s*delete,\s*truncate\s+on\s+platform\.access_log/i.test(declaring!.sql),
      "platform.access_log must keep its explicit revoke of UPDATE, DELETE and TRUNCATE.",
    ).toBe(true);
  });
});
