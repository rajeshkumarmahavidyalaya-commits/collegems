import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The list behind the critic.
 *
 * `family_login_problems()` said *"301 of 302 active students have nobody who
 * can sign in"* and stopped. An office reading that has to do something about
 * 301 named children and the sentence names none of them. Rule 11 decides the
 * shape: **do not add a screen to answer a question** — the list is a catalogue
 * row, and `/reports` renders it without being edited.
 *
 * ## …and writing it found the critic lying
 *
 * `students` is readable by every staff role; `user_profiles` has two SELECT
 * policies — *admins view tenant profiles* and *self views own profile* — and
 * `invitations` has only the admin one. So the critic's `not exists` had its
 * two sides narrowed by different policies, which is `student_exit_problems`
 * accusing a teacher's 200 children and `attendance_coverage` reporting eleven
 * classes at 0.0%, for the third time.
 *
 * Demonstrated by granting `users.manage` to the Accountant role in a
 * rolled-back transaction, with one guardian given a real login so that 301 is
 * the true answer:
 *
 *     seat                        family.no_login       family.stale_invitations
 *     admin                       301 of 302, info      1 expired
 *     accountant + users.manage   302 of 302, **warn**  **absent**
 *
 * An over-report, a severity escalation, and a silent under-report — none of
 * them visible from the seat anybody tests with. After migration `0235`, both
 * seats read 301 of 302 and both see the expired invitation.
 *
 * Every assertion here reads a file, so this runs without a database. The
 * isolation half — a definer read model's `where tenant_id =` **is** the
 * boundary — is pinned in `tests/rls/tenant-isolation.test.ts`, beside the
 * policies.
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

/** Comments stripped — a guard that reads prose reports on the prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * The body of a function's **latest** definition. Anchored on
 * `create or replace function`, because `comment on function` carries the name
 * too and comes after the body — CLAUDE.md records that bug twice.
 */
function functionBody(name: string): string {
  const sql = code(migrationSql());
  const marker = `create or replace function public.${name}(`;
  const start = sql.lastIndexOf(marker);
  expect(start, `no migration defines public.${name}`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end === -1 ? undefined : end);
}

describe("the list behind family_login_problems", () => {
  it("reads the evidence through a definer that filters by tenant itself", () => {
    const body = functionBody("family_login_status");

    // Definer, because user_profiles and invitations are admin-only and an
    // invoker version cannot tell absence from invisibility.
    expect(body).toMatch(/security definer/);

    // ...and therefore the tenant predicate is the isolation, not an
    // optimisation on top of one. Rule 11 inverted, in the one place it may be.
    expect(body).toMatch(/v_tenant_id uuid := public\.current_tenant_id\(\)/);
    expect(body).toMatch(/s\.tenant_id = v_tenant_id/);

    // Two, not one: the same sentence for the invitation count.
    const stale = functionBody("family_login_stale_invitations");
    expect(stale).toMatch(/security definer/);
    expect(stale).toMatch(/i\.tenant_id = v_tenant_id/);
  });

  it("refuses a caller who may not ask, rather than answering nothing", () => {
    // A definer that returned an empty set to somebody without the permission
    // is indistinguishable from a school where every family can sign in —
    // which is the exact failure this migration exists to remove.
    for (const name of ["family_login_status", "family_login_stale_invitations"]) {
      const body = functionBody(name);
      const gate = body.slice(body.indexOf("role_has_permission('users.manage')"));
      expect(gate, `${name} does not gate on users.manage`).not.toBe("");
      expect(gate.slice(0, 200), `${name} returns quietly instead of refusing`).toContain(
        "raise exception",
      );
    }
  });

  it("counts the rows it lists, rather than asking a second time", () => {
    // One definition consulted by both, so a school cannot be told 301 on
    // Needs attention and shown 287 on the report.
    const critic = functionBody("family_login_problems");
    expect(critic).toMatch(/from public\.family_login_status\(null\) f/);
    expect(critic).toMatch(/count\(\*\) filter \(where f\.state <> 'ok'\)/);

    // The old body's `not exists` over user_profiles is the thing being
    // replaced; a second copy of it here is how the two answers drift apart.
    expect(
      critic.includes("not exists"),
      "the critic re-implements the question family_login_status answers",
    ).toBe(false);

    const report = functionBody("report_family_logins");
    expect(report).toMatch(/from public\.family_login_status\(/);
    expect(report).toMatch(/f\.state <> 'ok'/);
  });

  it("is a catalogue row and not a screen", () => {
    // Rule 11: a new report is a function plus one row, and /reports renders
    // it. A page here would be a second place to keep the question.
    const sql = code(migrationSql());

    // Anchored on the **insert**, not on any mention of the key. The first
    // draft sliced from `lastIndexOf("'users.family_logins',")` and went green
    // — until migration `0237` added
    // `where key in ('users.family_logins', 'students.roster')`, which is now
    // the last mention, and the slice was a `where` clause. CLAUDE.md has this
    // bug twice already, from `lastIndexOf` of a function name finding its
    // `comment on function`; a key is no more unique than a name.
    const inserts = [...sql.matchAll(/insert into reference\.reports\b/g)].map((m) => m.index!);
    const row = inserts
      .map((start) => sql.slice(start, sql.indexOf("on conflict", start)))
      .find((block) => block.includes("'users.family_logins',"));

    expect(row, "no insert into reference.reports carries this report").toBeDefined();
    expect(row!).toContain("'users.manage'");
    expect(row!).toContain("report_family_logins");

    const pages = readdirSync(join(ROOT, "src/app/(app)"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(pages, "a report does not get its own route").not.toContain("family-logins");
  });

  it("says what is in the way, not merely that something is", () => {
    // "301 children have no login" is the number the office already had. The
    // list is only worth opening if each row names the next action, and the
    // five states are five different ones.
    const body = functionBody("family_login_status");
    for (const state of ["no_guardian", "no_address", "not_invited", "invited", "expired"]) {
      expect(body, `the state ${state} is not distinguished`).toContain(`'${state}'`);
    }

    // ...and the report turns each into a sentence rather than shipping the
    // machine word to a person.
    const report = functionBody("report_family_logins");
    expect(report).toContain("No guardian linked");
    expect(report).toContain("No email or phone on any guardian");
    expect(report).toContain("Invitation expired");
  });
});
