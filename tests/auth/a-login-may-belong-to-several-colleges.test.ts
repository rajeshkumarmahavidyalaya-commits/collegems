import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A login may belong to several colleges, and the first page picks one (0323).
 *
 * The rule that keeps this inside rule 1: **a token carries one college at a
 * time.** Every policy reads the tenant from the JWT, so switching is a write
 * to the active profile and the token's claims -- never a wider read. The SQL
 * is read from the migrations with comments stripped, resolved to the latest
 * definition, because the DB suites need sign-ins this sandbox cannot make.
 * The behaviour was probed live in rolled-back transactions; see
 * docs/modules/schools.md.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = FILES.map((f) => strip(readFileSync(join(DIR, f), "utf8")));
const ALL = SQL.join("\n");

function latest(name: string): { header: string; body: string } {
  for (const sql of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    const end = sql.indexOf("$$", start + 2);
    return { header: sql.slice(m.index!, start), body: sql.slice(start + 2, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the picker lists the caller's own colleges and nothing else", () => {
  it("my_schools is a definer filtered by the caller's own id", () => {
    const { header, body } = latest("my_schools");
    expect(header).toMatch(/security definer/);
    expect(body).toMatch(/where m\.user_id = auth\.uid\(\)/);
    expect(ALL).toMatch(/revoke all on function public\.my_schools\(\) from public, anon;/);
  });

  it("projects metadata only: no child, family, money or mark table is read", () => {
    const { body } = latest("my_schools");
    for (const table of ["students", "people", "guardians", "guardian_student", "ledger_entries", "invoices", "marks", "exam_results", "attendance_records"]) {
      expect(body, table).not.toMatch(new RegExp(`public\\.${table}\\b`));
    }
  });

  it("the counts are only for a college the caller administers", () => {
    const { body } = latest("my_schools");
    expect(body.match(/case when a\.admin and m\.is_active then/g)?.length).toBe(2);
  });
});

describe("switching is a write to the active profile, never a wider read", () => {
  it("school_switch checks the membership, and that it is active, before anything moves", () => {
    const { header, body } = latest("school_switch");
    expect(header).toMatch(/security definer/);
    const check = body.indexOf("if m.id is null or not m.is_active then");
    const move = body.indexOf("perform public.membership_activate_profile(v_uid, p_tenant_id)");
    expect(check).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(check);
    expect(body).toMatch(/where user_id = v_uid and tenant_id = p_tenant_id/);
    expect(body).toMatch(/platform\.operators/);
  });

  it("the activation writes the profile and the token's tenant and role, asserting each", () => {
    const { body } = latest("membership_activate_profile");
    expect(body).toMatch(/update public\.user_profiles\s+set tenant_id = m\.tenant_id/);
    expect(body).toMatch(/jsonb_build_object\('tenant_id', p_tenant, 'role', v_code\)/);
    // The role is looked up inside the target college, never taken on trust.
    expect(body).toMatch(/r\.id = m\.role_id and r\.tenant_id = p_tenant/);
    expect(body.match(/get diagnostics v_rows = row_count/g)?.length).toBe(2);
  });

  it("the profile keeps its membership on every write, through one trigger", () => {
    expect(ALL).toMatch(
      /create trigger user_profiles_keep_membership\s+after insert or update of tenant_id, role_id, person_id, student_id, staff_id, guardian_id, is_active\s+on public\.user_profiles/,
    );
  });

  it("the membership table has no write policy: every write is a definer", () => {
    const policies = [...ALL.matchAll(/create policy "[^"]+" on public\.school_memberships\s+for (\w+)/g)].map((m) => m[1]);
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.every((p) => p === "select")).toBe(true);
  });
});

describe("one college's decision does not reach another", () => {
  it("switching off somebody who belongs elsewhere does not ban them", () => {
    const { body } = latest("membership_leave");
    const full = body.indexOf("perform public.login_close(p_tenant, p_user, false)");
    const other = body.indexOf("if v_other is null then");
    // The full close (ban, sessions ended) happens only when there is no other
    // active college.
    expect(other).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(other);
    expect(body.slice(other, full)).not.toMatch(/end if;/);
    expect(body).toMatch(/perform public\.membership_activate_profile\(p_user, v_other\)/);
  });

  it("the team screen uses the membership doors, and the old ones are closed to JWT roles", () => {
    const actions = src("src/app/(app)/settings/team/login-actions.ts");
    expect(actions).toMatch(/rpc\("team_set_access"/);
    expect(actions).toMatch(/rpc\("team_set_role"/);
    expect(actions).not.toMatch(/rpc\("login_set_access"/);
    expect(actions).not.toMatch(/rpc\("login_set_role"/);
    expect(ALL).toMatch(/revoke all on function public\.login_set_access\(uuid, boolean\) from public, anon, authenticated;/);
    expect(ALL).toMatch(/revoke all on function public\.login_set_role\(uuid, uuid\) from public, anon, authenticated;/);
  });
});

describe("a new college is one definition", () => {
  it("both founders call college_create, and only college_create inserts a tenant", () => {
    expect(latest("platform_start_school").body).toMatch(/public\.college_create\(/);
    expect(latest("school_add").body).toMatch(/public\.college_create\(/);
    expect(latest("platform_start_school").body).not.toMatch(/insert into public\.tenants/);
    expect(latest("school_add").body).not.toMatch(/insert into public\.tenants/);
    expect(latest("college_create").body).toMatch(/insert into public\.tenants/);
  });

  it("adding a school needs users.manage, refuses an operator and is bounded", () => {
    const { body } = latest("school_add");
    expect(body).toMatch(/role_has_permission\('users\.manage'\)/);
    expect(body).toMatch(/platform\.operators/);
    expect(body).toMatch(/v_count >= 10/);
  });
});

describe("the screens", () => {
  it("the first page after signing in is the picker for an administrator or a member of several", () => {
    const login = src("src/app/login/actions.ts");
    expect(login).toMatch(/rpc\("my_schools"\)/);
    expect(login).toMatch(/"\/schools"/);
    expect(login).toMatch(/safeNext\(/);
  });

  it("a switch refreshes the session, because the old token names the old college", () => {
    const actions = src("src/app/(app)/schools/actions.ts");
    const rpc = actions.indexOf('rpc("school_switch"');
    const refresh = actions.indexOf("auth.refreshSession()");
    expect(rpc).toBeGreaterThan(0);
    expect(refresh).toBeGreaterThan(rpc);
  });

  it("a stranger can find sign-up, and founding a college lands on School Management", () => {
    expect(src("src/app/login/page.tsx")).toMatch(/href="\/signup"/);
    // The confirmation link comes back through the callback and on to /start.
    expect(src("src/app/signup/actions.ts")).toMatch(/emailRedirectTo: `\$\{origin\}\/auth\/callback\?next=\/start`/);
    expect(src("src/app/start/actions.ts")).toMatch(/redirect\("\/schools"\)/);
  });
});
