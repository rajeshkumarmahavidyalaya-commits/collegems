import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0332: `college_create` makes six roles from a literal list, and until then
 * none of them said which record its logins stand for, so a new college could
 * never invite a parent or a student. The subject is data now; this fails when
 * a role is added to that list without saying, or without being named as
 * deliberately subject-less.
 */
const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");

/** The latest migration defining a function, anchored on `create ... function`. */
function latest(name: string): string {
  for (const f of [...files].reverse()) {
    const sql = strip(readFileSync(join(dir, f), "utf8"));
    const at = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
    if (at >= 0) return sql.slice(at, sql.indexOf("$$;", sql.indexOf("$$", at) + 2));
  }
  throw new Error(`${name} is defined nowhere`);
}

/** The founder is an administrator with no staff record (see 0332's header). */
const NO_SUBJECT_ON_PURPOSE = new Set(["admin"]);

describe("a new college's roles say whose login they are (0332)", () => {
  const seeded = (() => {
    const body = latest("college_create");
    const insert = body.slice(body.indexOf("insert into public.roles"), body.indexOf(";", body.indexOf("insert into public.roles")));
    return [...insert.matchAll(/\(v_tenant,\s*'(\w+)'/g)].map((m) => m[1]);
  })();
  const defaults = (() => {
    const sql = strip(readFileSync(join(dir, "0332_a_new_college_s_roles_stand_for_someone.sql"), "utf8"));
    const insert = sql.slice(sql.indexOf("insert into reference.role_subject_defaults"));
    return new Map([...insert.slice(0, insert.indexOf(";")).matchAll(/\('(\w+)',\s*'(\w+)'\)/g)].map((m) => [m[1], m[2]]));
  })();

  it("reads the six shipped roles", () => {
    expect(seeded.sort()).toEqual(["accountant", "admin", "librarian", "parent", "student", "teacher"]);
  });

  it("gives every shipped role a subject, or names it as deliberately without one", () => {
    const silent = seeded.filter((code) => !defaults.has(code) && !NO_SUBJECT_ON_PURPOSE.has(code));
    expect(silent).toEqual([]);
  });

  it("files a parent's login under a guardian and a student's under themselves", () => {
    expect(defaults.get("parent")).toBe("guardian");
    expect(defaults.get("student")).toBe("student");
  });

  it("applies them where every insert passes, not in one caller", () => {
    const sql = strip(readFileSync(join(dir, "0332_a_new_college_s_roles_stand_for_someone.sql"), "utf8"));
    expect(sql).toMatch(/create trigger roles_default_subject\s+before insert on public\.roles/);
  });
});
