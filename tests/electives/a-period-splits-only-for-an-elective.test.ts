import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A period can hold several lessons only when the class splits for an elective
 * (0286). The rule is a trigger, because an administrator's plain insert routes
 * around any function; the write function, the copy and the busy list must all
 * treat a parallel lesson as a lesson; and a family is shown only the one their
 * child takes, through the one definition `student_takes_subject`.
 *
 * Read from the latest migration defining each function, comments stripped: a
 * guard that reads prose reports on the prose.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const strip = (s: string) => s.replace(/--.*$/gm, "");

function latestBody(name: string): { file: string; body: string } {
  for (const file of [...FILES].reverse()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$", m.index!);
    const tag = sql.slice(start, sql.indexOf("$", start + 1) + 1);
    const end = sql.indexOf(tag, start + tag.length);
    return { file, body: strip(sql.slice(start + tag.length, end)) };
  }
  throw new Error(`${name} is defined nowhere`);
}

const ALL_SQL = FILES.map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));

describe("a period splits only for an elective", () => {
  it("keys a lesson by its subject, and guards the period with a trigger", () => {
    const created = ALL_SQL.filter(({ sql }) =>
      /create trigger timetable_entries_share_a_period\s+before insert or update/.test(sql),
    );
    expect(created.map((c) => c.f)).toEqual(["0286_parallel_electives_unchosen_papers_and_the_admission_fee.sql"]);
    const { body } = latestBody("timetable_entries_share_a_period");
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).toMatch(/public\.subject_group_options/);
    expect(body).toMatch(/raise exception/);
  });

  it("no longer writes against the one-subject-per-period key", () => {
    // Every writer after 0286 upserts on the key that includes the subject.
    const late = ALL_SQL.filter(({ f }) => f >= "0286");
    for (const { f, sql } of late) {
      expect(sql, f).not.toMatch(/on conflict on constraint timetable_entries_section_slot_key\b/);
    }
    for (const name of ["timetable_set_entry", "timetable_copy_day"]) {
      const { file, body } = latestBody(name);
      expect(body, `${name} in ${file}`).toMatch(/timetable_entries_section_slot_subject_key/);
    }
  });

  it("edits a lesson by id and checks clashes against every other lesson in the period", () => {
    const { body } = latestBody("timetable_set_entry");
    expect(body).toMatch(/p_entry_id/);
    // The old exclusion hid a parallel lesson's teacher from the clash check.
    expect(body).not.toMatch(/section_id <> p_section_id/);
    expect(body.match(/e\.id is distinct from v_target_id/g)?.length).toBe(2);
    // An update no policy matches changes nothing and raises nothing (rule 6).
    expect(body).toMatch(/get diagnostics v_rows = row_count/);
  });

  it("counts a parallel lesson as busy, excluding only the lesson being edited", () => {
    const { body } = latestBody("timetable_busy_in_slot");
    expect(body).toMatch(/e\.id <> p_entry_id/);
    expect(body).not.toMatch(/section_id <> p_section_id/);
  });

  it("copies into empty periods only, a split period whole", () => {
    const { body } = latestBody("timetable_copy_day");
    expect(body).toMatch(/filled\.time_slot_id = src\.time_slot_id/);
  });

  it("shows a family the lesson their child takes, through the one definition", () => {
    const { body } = latestBody("timetable_for_section");
    expect(body).toMatch(/public\.student_takes_subject\(/);
    // Staff see the whole class, even with a child in it.
    expect(body).toMatch(/staff_id is null/);
    // Not the tier: it decides what is shown in the app, never in SQL (0208).
    expect(body).not.toMatch(/current_role_tier/);
  });

  it("draws a period as a list of lessons and saves by id", () => {
    const grid = readFileSync(join(process.cwd(), "src/app/(app)/timetable/routine-grid.tsx"), "utf8");
    expect(grid).toMatch(/new Map<string, RoutineEntry\[\]>/);
    expect(grid).toMatch(/entryId: entry\?\.id \?\? ""/);
    const actions = readFileSync(join(process.cwd(), "src/app/(app)/timetable/actions.ts"), "utf8");
    expect(actions).toMatch(/p_entry_id: parsed\.data\.entryId/);
    const busy = actions.slice(actions.indexOf("export async function getBusyInSlot"));
    expect(busy.slice(0, busy.indexOf("\n}\n"))).toMatch(/p_entry_id: entryId/);
  });
});

describe("a child who has not chosen is counted", () => {
  it("exams_problems asks the definer read model", () => {
    const { body } = latestBody("exams_problems");
    expect(body).toMatch(/public\.exams_unchosen_electives\(p_exam_id\)/);
    // Number agreement lives in one sentence: student/students, has/have.
    expect(body).toMatch(/' student in ' else ' students in '/);
    expect(body).toMatch(/' has not ' else ' have not '/);
  });

  it("counts from a definer that filters the tenant, asks the matrix, and projects counts", () => {
    const { file, body } = latestBody("exams_unchosen_electives");
    const sql = readFileSync(join(DIR, file), "utf8");
    expect(sql).toMatch(/function public\.exams_unchosen_electives[\s\S]*?security definer/);
    expect(body).toMatch(/e\.tenant_id = public\.current_tenant_id\(\)/);
    expect(body).toMatch(/role_has_permission\('exams\.manage'\)/);
    expect(body).toMatch(/count\(\*\)::integer/);
    // Counts, never names.
    expect(body).not.toMatch(/first_name|last_name|admission_number/);
    expect(sql).toMatch(/revoke all on function public\.exams_unchosen_electives\(uuid\) from public, anon;/);
  });
});
