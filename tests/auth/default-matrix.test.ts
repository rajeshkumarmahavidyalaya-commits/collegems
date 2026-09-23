import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What a college founded today may do, decided for every permission.
 *
 * Until migration `0269`, `platform_start_school` seeded a new college's
 * non-administrator roles from **four literal lists written in 0209**, and
 * every permission added since was granted by reading the matrix of colleges
 * that already existed. Measured against the demo college, a college founded
 * the day `0269` was written would have started with a teacher missing 12
 * permissions (`notices.view`, `leave.decide`, `exams.remark` among them), an
 * accountant missing 18, and families unable to read the notice board or apply
 * for leave. The administrator — who gets every row — was unaffected, which is
 * why nobody saw it.
 *
 * `reference.role_permission_defaults` is the default matrix as data now, and
 * this file makes the question impossible to skip: **every permission a
 * migration declares is either granted by default to some non-administrator
 * role, or named below as the administrator's alone, with the reason.** The
 * `nav-audience` guard's shape (rule 4): a decision is allowed either way, and
 * forgetting to make it is not.
 *
 * Runs without a database. A row-for-row check that a founded college matches
 * the catalogue was done live when `0269` shipped (six roles, zero differences),
 * and belongs to the probe rather than to CI.
 */

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Every permission code the catalogue declares — the same parse `permission-catalogue.test.ts` uses. */
function declaredCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of migrationFiles()) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    for (const stmt of sql.matchAll(/insert\s+into\s+reference\.permissions[\s\S]*?;/gi)) {
      for (const tuple of stmt[0].matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'\s*,/gi)) found.add(tuple[1]);
    }
  }
  return found;
}

/** `role -> codes` from every insert into (and delete from) the defaults catalogue, in order. */
function defaultMatrix(): Map<string, Set<string>> {
  const matrix = new Map<string, Set<string>>();
  for (const file of migrationFiles()) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    for (const stmt of sql.matchAll(/insert\s+into\s+reference\.role_permission_defaults[\s\S]*?;/gi)) {
      for (const t of stmt[0].matchAll(/\(\s*'([a-z]+)'\s*,\s*'([a-z_]+\.[a-z_]+)'\s*\)/gi)) {
        if (!matrix.has(t[1])) matrix.set(t[1], new Set());
        matrix.get(t[1])!.add(t[2]);
      }
    }
    for (const stmt of sql.matchAll(
      /delete\s+from\s+reference\.role_permission_defaults\s+where\s+role_code\s*=\s*'([a-z]+)'\s+and\s+permission_code\s*=\s*'([a-z_]+\.[a-z_]+)'/gi,
    )) {
      matrix.get(stmt[1])?.delete(stmt[2]);
    }
  }
  return matrix;
}

/**
 * Held by the administrator alone in a college founded today, on purpose.
 *
 * Grouped by the reason rather than listed one by one, because the reasons are
 * few: each of these is either **the college's own configuration**, **a
 * decision about other people's records**, or **the whole of a module a
 * college delegates deliberately** — and a college can grant any of them to
 * anybody at `/settings/permissions` the day it starts.
 */
const ADMINISTRATOR_ALONE: Record<string, string> = {
  ...Object.fromEntries(
    ["settings.manage", "users.manage", "audit.view", "import.view", "import.prepare", "import.apply"].map(
      (c) => [c, "the college's own configuration and its logins: whoever holds these can grant the rest"],
    ),
  ),
  ...Object.fromEntries(
    [
      "academics.manage",
      "exams.manage",
      "exams.publish",
      "fees.manage",
      "promotion.manage",
      "students.manage",
      "guardians.manage",
      "staff.manage",
      "staff.view",
      "hr.manage",
      "certificates.issue",
      "certificates.manage",
      "frontoffice.admit",
    ].map((c) => [
      c,
      "a decision about other people's records -- who is enrolled, what they are charged, what a " +
        "certificate says, who is employed -- which a college delegates to a named person, not a role by default",
    ]),
  ),
  ...Object.fromEntries(
    [
      "communication.send",
      "communication.view",
      "notices.manage",
      "schedules.manage",
      "substitutions.manage",
      "hostel.manage",
      "hostel.allocate",
      "transport.manage",
      "transport.assign",
    ].map((c) => [
      c,
      "the office's side of a module: sending to every family, arranging cover, placing children on a " +
        "bus or in a bed -- delegated when a college has a warden, a transport clerk or a coordinator",
    ]),
  ),
};

describe("every permission says who gets it in a new college", () => {
  const declared = declaredCodes();
  const matrix = defaultMatrix();
  const byDefault = new Set([...matrix.values()].flatMap((s) => [...s]));

  it("reads the catalogues at all", () => {
    // Two parsers that matched nothing would pass everything below.
    expect(declared.size).toBeGreaterThan(60);
    expect(byDefault.size).toBeGreaterThan(40);
    expect([...matrix.keys()].sort()).toEqual(["accountant", "librarian", "parent", "student", "teacher"]);
  });

  it("no permission is left undecided", () => {
    const undecided = [...declared].filter((c) => !byDefault.has(c) && !(c in ADMINISTRATOR_ALONE)).sort();
    expect(
      undecided,
      "A new permission reaches existing colleges by reading the matrix, and a college founded " +
        "tomorrow only through reference.role_permission_defaults. Add a row there for each role " +
        "that should start with it, or name it in ADMINISTRATOR_ALONE with the reason.",
    ).toEqual([]);
  });

  it("the list of the administrator's own is read both ways", () => {
    // A line explaining a decision nobody is making: granted by default after
    // all, or no longer in the catalogue. `nav-audience`'s rule.
    const stale = Object.keys(ADMINISTRATOR_ALONE).filter((c) => byDefault.has(c) || !declared.has(c));
    expect(stale).toEqual([]);
  });

  it("the defaults name only permissions that exist", () => {
    expect([...byDefault].filter((c) => !declared.has(c))).toEqual([]);
  });

  it("the founding function reads the catalogue and carries no list of its own", () => {
    let body = "";
    for (const file of migrationFiles()) {
      const sql = stripComments(readFileSync(join(MIGRATIONS, file), "utf8"));
      const at = sql.search(/create (?:or replace )?function public\.platform_start_school\s*\(/);
      if (at === -1) continue;
      const rest = sql.slice(at);
      body = rest.slice(0, rest.indexOf("\n$$;"));
    }
    expect(body).toContain("reference.role_permission_defaults");
    // 0209's shape: `p.code in ('students.view', ...)`. Verified by planting it.
    expect(body).not.toMatch(/p\.code\s+in\s*\(\s*'/);
  });
});
