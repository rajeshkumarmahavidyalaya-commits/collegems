import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A tier decides what a person is SHOWN. It never decides what they may do.
 *
 * `roles.tier` is presentation: three audiences — student, staff, principal —
 * so the product can have a landing page and a menu that make sense for each.
 * Rule 4 is unchanged underneath it: `role_permissions` and RLS are the gate.
 *
 * The problem is that a tier column sitting beside a permission matrix looks
 * *exactly* like a shortcut. `tier = 'principal'` is shorter than
 * `role_has_permission('settings.manage')`, reads as if it means the same
 * thing, and would quietly replace a per-college decision (which permissions a
 * role holds, editable from `/settings`) with a hardcoded one.
 *
 * It would also be wrong in a way nobody would notice: a college can grant a
 * teacher `students.manage` any Tuesday, and a policy written against the tier
 * would refuse them while the matrix said yes.
 *
 * So this scans the migrations for the tier appearing anywhere it could act as
 * a gate. It runs without a database, which is the point — the DB-backed suites
 * cannot run in every environment, and this rule must be enforceable in all of
 * them.
 */

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

function migrationSources(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), "utf8") }));
}

/** Strip `--` line comments, so the prose explaining the rule is not read as a breach of it. */
function withoutComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

describe("roles.tier is presentation, not authorization", () => {
  it("never appears inside a policy", () => {
    // `create policy ... using (...) with check (...)` is the boundary rule 1
    // and rule 4 rest on. A tier in one of those would be a second, coarser
    // answer to a question the matrix already answers per college.
    const offenders: string[] = [];

    for (const { file, sql } of migrationSources()) {
      const code = withoutComments(sql);
      // Each CREATE POLICY statement, up to its terminating semicolon.
      for (const match of code.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        const policy = match[0];
        if (/current_role_tier\s*\(/i.test(policy) || /\btier\s*(=|in|<>|!=)/i.test(policy)) {
          offenders.push(`${file}: ${policy.slice(0, 120).replace(/\s+/g, " ")}`);
        }
      }
    }

    expect(
      offenders,
      "A tier decides what is shown, never what is allowed. Gate on " +
        "role_has_permission() or on RLS — a policy comparing the tier hardcodes " +
        "a decision each college is supposed to make from /settings.",
    ).toEqual([]);
  });

  it("never stands in for a permission check inside a function", () => {
    // The other place a shortcut would land: `if current_role_tier() <>
    // 'principal' then raise` inside a write function, instead of the
    // permission the college actually grants.
    const offenders: string[] = [];

    for (const { file, sql } of migrationSources()) {
      const code = withoutComments(sql);
      for (const match of code.matchAll(/current_role_tier\s*\(\s*\)/gi)) {
        const around = code.slice(Math.max(0, match.index! - 200), match.index! + 200);
        // Its one legitimate use is being defined and granted. Anything that
        // compares it to a tier name is making a decision with it.
        if (/(if|and|or|when|where|check)\b[^;]*current_role_tier\s*\(\s*\)\s*(=|<>|!=|in)/i.test(around)) {
          offenders.push(`${file}: ${around.slice(150, 300).replace(/\s+/g, " ")}`);
        }
      }
    }

    expect(
      offenders,
      "current_role_tier() was compared to a value in a way that decides an " +
        "outcome. Use role_has_permission(), which a college can change.",
    ).toEqual([]);
  });

  it("the three tiers are the only ones the schema allows", () => {
    // The vocabulary lives in the CHECK constraint (this codebase's convention:
    // a list of valid values belongs in one place, and the constraint is
    // usually that place). If a fourth tier is ever added, this test is where
    // somebody is reminded that the TypeScript union has to move with it.
    const declaring = migrationSources().find(({ sql }) => /roles\s*\n?\s*add column if not exists tier/i.test(sql));
    expect(declaring, "the migration declaring roles.tier should still exist").toBeDefined();

    const check = declaring!.sql.match(/check\s*\(tier in \(([^)]*)\)\)/i);
    expect(check, "roles.tier should still carry its CHECK").not.toBeNull();

    const tiers = check![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(tiers).toEqual(["principal", "staff", "student"]);
  });
});
