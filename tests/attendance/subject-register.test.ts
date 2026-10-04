import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Attendance by subject (0329). A subject register is its own table so that
 * nothing which counts days counts a lecture, and its only write is a definer
 * that answers an administrator, the class teacher or that subject's teacher.
 * Read from the migrations with comments stripped, latest definition first;
 * the behaviour was probed live in a rolled-back transaction as an
 * administrator and a teacher (see docs/modules/attendance.md).
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

describe("a lecture is never counted as a day", () => {
  it("the subject register has read policies only: every write is the definer", () => {
    const policies = [...ALL.matchAll(/create policy "[^"]+" on public\.subject_attendance_records\s+for (\w+)/g)].map((m) => m[1]);
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.every((p) => p === "select")).toBe(true);
  });

  it("no reader of the daily register reads the subject register", () => {
    for (const name of ["dashboard_summary", "attendance_coverage", "report_attendance_summary", "exams_attendance_summary", "mark_attendance"]) {
      expect(latest(name).body, name).not.toMatch(/subject_attendance_records/);
    }
  });

  it("the by-month sheet reads the daily register's period 0, as the caller", () => {
    const { header, body } = latest("attendance_month_sheet");
    expect(header).not.toMatch(/security definer/);
    expect(body).toMatch(/role_has_permission\('attendance\.view'\)/);
    expect(body).toMatch(/from public\.attendance_records ar/);
    expect(body).toMatch(/ar\.period = 0/);
  });
});

describe("who may take a subject's register", () => {
  it("mark_subject_attendance checks the caller before it writes, and the year by tenant", () => {
    const { header, body } = latest("mark_subject_attendance");
    expect(header).toMatch(/security definer/);
    const check = body.indexOf("if not public.subject_register_may(v_tenant, v_section.id, p_subject_id) then");
    const year = body.indexOf("where a.tenant_id = v_tenant and p_date between a.start_date and a.end_date");
    const write = body.indexOf("insert into public.subject_attendance_records");
    expect(check).toBeGreaterThan(0);
    expect(year).toBeGreaterThan(check);
    expect(write).toBeGreaterThan(year);
    // Tenant by hand: no policy runs inside a definer.
    expect(body).toMatch(/s\.id = p_section_id and s\.tenant_id = v_tenant/);
  });

  it("the helper is closed to JWT roles, and the two readers check it", () => {
    expect(ALL).toMatch(/revoke all on function public\.subject_register_may\(uuid, uuid, uuid\) from public, anon, authenticated;/);
    expect(latest("subject_register").body).toMatch(/if not public\.subject_register_may\(v_tenant, v_section\.id, p_subject_id\) then/);
    expect(latest("attendance_subject_month_sheet").body).toMatch(/v_wide or public\.subject_register_may\(v_tenant, s\.id, p_subject_id\)/);
  });

  it("an empty answer is a refusal, not an empty sheet", () => {
    expect(latest("attendance_subject_month_sheet").body).toMatch(/if v_sections is null then\s+raise exception/);
  });
});
