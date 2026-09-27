import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A record with history is kept; a mistake can be removed (0288).
 *
 * Before 0288 an administrator's plain `delete from students` cascaded into the
 * child's fee ledger (4 entries -> 0) and a `delete from staff` into payslips
 * (3 -> 0), because referential actions run as the table owner and rule 6's
 * revoke does not stop them. The guard is a trigger, since a plain delete
 * through PostgREST routes around any function. Read from the migrations, with
 * comments stripped: a guard that reads prose reports on the prose.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = FILES.map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));

function latestBody(name: string): { file: string; body: string; header: string } {
  for (const { f, sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$$", m.index!);
    const end = sql.indexOf("$$", start + 2);
    return { file: f, header: sql.slice(m.index!, start), body: sql.slice(start + 2, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a record with history is kept", () => {
  for (const [table, fn] of [
    ["students", "guard_student_delete"],
    ["staff", "guard_staff_delete"],
    ["sections", "guard_section_delete"],
    ["class_levels", "guard_class_level_delete"],
  ] as const) {
    it(`${table} is guarded by a BEFORE DELETE trigger`, () => {
      const all = SQL.map((s) => s.sql).join("\n");
      expect(all).toMatch(
        new RegExp(`create trigger ${fn} before delete on public\\.${table}\\s+for each row execute function public\\.${fn}\\(\\)`),
      );
      const { header, body } = latestBody(fn);
      // Definer, so it counts every row rather than the rows the caller sees.
      expect(header).toMatch(/security definer/);
      // A whole college being removed is the one exemption.
      expect(body).toMatch(/not exists \(select 1 from public\.tenants where id = t\)/);
      expect(body).toMatch(/raise exception/);
      const revoked = SQL.some(({ sql }) =>
        new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated`).test(sql),
      );
      expect(revoked).toBe(true);
    });
  }

  it("counts the money and the register for a student, and the payroll for staff", () => {
    const student = latestBody("guard_student_delete").body;
    for (const t of ["ledger_entries", "invoices", "attendance_records", "marks", "exam_results", "certificates"]) {
      expect(student, t).toContain(`public.${t}`);
    }
    const staff = latestBody("guard_staff_delete").body;
    for (const t of ["payslips", "staff_attendance", "leave_requests", "substitutions"]) {
      expect(staff, t).toContain(`public.${t}`);
    }
  });

  it("deletes the role row before the person, so a refusal can name them", () => {
    for (const [fn, table] of [["staff_delete", "staff"], ["student_delete", "students"]] as const) {
      const { body } = latestBody(fn);
      const role = body.indexOf(`delete from public.${table} where id`);
      const person = body.indexOf("delete from public.people where id = v_person");
      expect(role, fn).toBeGreaterThan(0);
      expect(person, fn).toBeGreaterThan(role);
      expect(body, fn).toMatch(/get diagnostics v_rows = row_count/);
      expect(body, fn).toMatch(/set status = 'revoked'/);
    }
  });

  it("never again writes a composite SET NULL that would null tenant_id", () => {
    // 0288 fixed fourteen; anything after it must name its columns.
    for (const { f, sql } of SQL.filter(({ f }) => f >= "0288")) {
      const bad = sql.match(/foreign key \(tenant_id,[^)]*\)\s+references[^;]*?on delete set null(?!\s*\()/gi);
      expect(bad, f).toBeNull();
    }
  });

  it("puts Delete on both records, and removes the photograph only after the row", () => {
    for (const [page, action] of [
      ["src/app/(app)/staff/[id]/page.tsx", "deleteStaffRecord"],
      ["src/app/(app)/students/[id]/page.tsx", "deleteStudentRecord"],
    ]) {
      expect(src(page)).toMatch(new RegExp(`<DeleteRecordControl[\\s\\S]*?${action}\\.bind`));
    }
    for (const [file, rpc] of [
      ["src/app/(app)/staff/actions.ts", "staff_delete"],
      ["src/app/(app)/students/actions.ts", "student_delete"],
    ]) {
      const s = src(file);
      const fn = s.slice(s.indexOf("Record(id: string)"));
      expect(fn.indexOf(`rpc("${rpc}"`)).toBeGreaterThan(0);
      expect(fn.indexOf("deletePhotoObject(")).toBeGreaterThan(fn.indexOf(`rpc("${rpc}"`));
    }
  });
});

describe("classes and sections can be made", () => {
  it("files a new section under the server's year, never the form's", () => {
    const s = src("src/app/(app)/academics/class-actions.ts");
    const save = s.slice(s.indexOf("export async function saveSection"), s.indexOf("export async function deleteSection"));
    expect(save).toMatch(/session_id: ctx\.currentSessionId/);
    expect(save).not.toMatch(/parsed\.data\.session/);
  });

  it("asserts a write happened, since a write no policy matches raises nothing", () => {
    const s = src("src/app/(app)/academics/class-actions.ts");
    expect(s.match(/data\.length === 0/g)?.length).toBe(4);
  });

  it("sends the first-run checklist to the tab that has the control", () => {
    expect(src("src/lib/validations/setup.ts")).toMatch(/href: "\/academics\?tab=classes"/);
    expect(src("src/app/(app)/academics/academics-settings.tsx")).toMatch(/<TabsTrigger value="classes">/);
  });
});
