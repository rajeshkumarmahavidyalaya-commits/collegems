import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A paper in an elective belongs only to the children who chose it (0285).
 * Three functions decide who sits a paper, and each must ask the one
 * definition, `student_takes_subject`. Read from the *latest* migration that
 * defines each function, because migrations change a function by redefining it
 * and "what does it do now" is a question about the highest-numbered file.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function latestBody(name: string): { file: string; body: string } {
  for (const file of [...FILES].reverse()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$", m.index!);
    const tag = sql.slice(start, sql.indexOf("$", start + 1) + 1);
    const end = sql.indexOf(tag, start + tag.length);
    return { file, body: sql.slice(start + tag.length, end).replace(/--.*$/gm, "") };
  }
  throw new Error(`${name} is defined nowhere`);
}

describe("an elective paper is sat only by those who chose it", () => {
  for (const name of ["exams_mark_sheet", "exams_subject_breakdown", "exams_enter_marks"]) {
    it(`${name} asks student_takes_subject`, () => {
      const { file, body } = latestBody(name);
      expect(body, `${name} in ${file}`).toMatch(/public\.student_takes_subject\(/);
    });
  }

  it("refuses a mark for a child who did not choose the subject, rather than storing it", () => {
    const { body } = latestBody("exams_enter_marks");
    const check = body.indexOf("student_takes_subject(");
    const firstInsert = body.indexOf("insert into public.marks");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(firstInsert);
    expect(body).toMatch(/raise exception '% did not choose this subject/);
  });

  it("answers from a definer that filters by tenant and returns a boolean", () => {
    const sql = readFileSync(join(DIR, latestBody("student_takes_subject").file), "utf8");
    const { body } = latestBody("student_takes_subject");
    expect(sql).toMatch(/function public\.student_takes_subject[\s\S]*?returns boolean[\s\S]*?security definer/);
    expect(body.match(/tenant_id = public\.current_tenant_id\(\)/g)?.length).toBe(2);
    expect(sql).toMatch(/revoke all on function public\.student_takes_subject\(uuid, uuid, uuid, uuid\) from public, anon;/);
  });

  it("keeps the shared subject screens free of any one caller's action", () => {
    for (const f of ["subjects-view.tsx", "choice-form.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src/components/electives", f), "utf8");
      expect(src, f).not.toMatch(/from "@\/app\//);
      expect(src, f).not.toMatch(/from "\.\.\/\.\.\/app/);
    }
  });
});
