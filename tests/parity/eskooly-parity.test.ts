import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { NAV_GROUPS, SETUP_ORDER, navForRole, splitSetup } from "@/components/app-shell/nav-config";
import { SETUP_STEPS } from "@/lib/validations/setup";
import { cellKey, parseScale, planBehaviourSave, scaleLegend } from "@/lib/validations/behaviour";
import { formatCell, parseCell, planTestMarks } from "@/lib/validations/class-tests";

/**
 * The eSkooly comparison's remaining four (0302-0305): the admitted screen,
 * setup in build order, behaviour and skills, class tests -- and the empty
 * marks sheet class tests found on the way.
 */
const ROOT = process.cwd();
const DIR = join(ROOT, "supabase/migrations");
const strip = (s: string) => s.replace(/--.*$/gm, "");
const SQL = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: strip(readFileSync(join(DIR, f), "utf8")) }));

function latest(name: string): { file: string; header: string; body: string } {
  for (const { f, sql } of [...SQL].reverse()) {
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
    const m = [...sql.matchAll(re)].pop();
    if (!m) continue;
    const start = sql.indexOf("$", m.index!);
    const tag = sql.slice(start, sql.indexOf("$", start + 1) + 1);
    const end = sql.indexOf(tag, start + tag.length);
    return { file: f, header: sql.slice(m.index!, start), body: sql.slice(start + tag.length, end) };
  }
  throw new Error(`${name} is defined nowhere`);
}

function policies(table: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const { sql } of SQL) {
    const re = new RegExp(`create policy "([^"]+)" on public\\.${table}\\b([\\s\\S]*?);`, "g");
    for (const m of sql.matchAll(re)) out.push({ name: m[1], text: m[2] });
  }
  return out;
}

const src = (p: string) =>
  readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("an admission ends on one screen of next steps", () => {
  it("a new admission lands there; an edit goes back to the record", () => {
    expect(src("src/app/(app)/students/student-form.tsx")).toMatch(
      /router\.push\(isEdit \? `\/students\/\$\{result\.data\.id\}` : `\/students\/\$\{result\.data\.id\}\/admitted`\)/,
    );
  });

  it("draws each step only for the permission its write needs", () => {
    const page = src("src/app/(app)/students/[id]/admitted/page.tsx");
    for (const [perm, flag] of [
      ["certificates.issue", "canIssue"],
      ["fees.collect", "canCollect"],
      ["users.manage", "canInvite"],
      ["transport.assign", "canAssignBus"],
      ["hostel.allocate", "canAllocateBed"],
    ]) {
      expect(page).toContain(`hasPermission("${perm}")`);
      expect(page).toMatch(new RegExp(`\\{${flag} && `));
    }
    expect(page).not.toMatch(/roleCode|roleTier/);
  });

  it("invites through the Team screen's own action, not a second one", () => {
    const action = src("src/app/(app)/students/admitted-actions.ts");
    expect(action).toMatch(/await invite\(\{ email, roleId: role\.id, subjectId: chosen\.guardian_id \}\)/);
    expect(action).not.toMatch(/from\("invitations"\)/);
  });
});

describe("setup runs in the order a college is built", () => {
  const { file, body } = latest("setup_progress");
  const keys = [...body.matchAll(/'key', '([a-z_]+)'/g)].map((m) => m[1]);

  it("in build order, with the staff and timetable steps", () => {
    expect(file).toMatch(/^0310_/);
    // 0310 added the year (second: every later step reads it) and messages
    // (before the invitations it is what delivers).
    expect(keys).toEqual([
      "profile", "year", "classes", "subjects", "fees", "staff", "students", "timetable", "messages",
      "staff_logins", "family_logins",
    ]);
  });

  it("every step the database sends has a label, and every label a step", () => {
    expect(Object.keys(SETUP_STEPS).sort()).toEqual([...keys].sort());
  });

  it("the Setup menu reads in the same order, and every listed address is a real setup entry", () => {
    const setupHrefs = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.setup).map((i) => i.href);
    for (const href of SETUP_ORDER) expect(setupHrefs, href).toContain(href);
    const { setup } = splitSetup(navForRole("admin"));
    const ranks = setup.map((i) => SETUP_ORDER.indexOf(i.href)).filter((r) => r !== -1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(setup[0].href).toBe("/settings/school");
  });
});

describe("behaviour and skills", () => {
  it("a publish freezes the grades: exam_status in the key, draft in every write policy", () => {
    const m = SQL.find((s) => s.f.startsWith("0303_"))!.sql;
    expect(m).toMatch(/foreign key \(tenant_id, exam_id, exam_status\)\s+references public\.exams \(tenant_id, id, status\)\s+on update cascade/);
    for (const p of policies("behaviour_ratings").filter((p) => /for all/.test(p.text))) {
      expect(p.text, p.name).toMatch(/exam_status = 'draft'/);
    }
  });

  it("never gated on exams.view, which every family holds (0249)", () => {
    for (const p of [...policies("behaviour_ratings"), ...policies("behaviour_traits")]) {
      expect(p.text, p.name).not.toMatch(/exams\.view/);
    }
    for (const p of policies("behaviour_ratings").filter((p) => /view/.test(p.name) && !/staff/.test(p.name))) {
      expect(p.text, p.name).toMatch(/exam_status = 'published'/);
    }
  });

  it("the traits reach a college founded tomorrow", () => {
    const m = SQL.find((s) => s.f.startsWith("0303_"))!.sql;
    expect(m).toMatch(/after insert on public\.tenants\s+for each row execute function public\.tenants_seed_behaviour_traits\(\)/);
  });

  it("saving writes only what changed, and a cleared cell is a delete", () => {
    const a = cellKey("s1", "t1");
    const b = cellKey("s1", "t2");
    const c = cellKey("s2", "t1");
    const plan = planBehaviourSave({ [a]: "A", [b]: "B" }, { [a]: "A", [b]: "C", [c]: "B" });
    expect(plan.upserts).toEqual([
      { studentId: "s1", traitId: "t2", grade: "C" },
      { studentId: "s2", traitId: "t1", grade: "B" },
    ]);
    expect(planBehaviourSave({ [a]: "A" }, {}).deletes).toEqual([{ studentId: "s1", traitId: "t1" }]);
  });

  it("prints on every report card surface through the two loaders", () => {
    const actions = src("src/app/(app)/exams/report-card-actions.ts");
    expect(actions.match(/behaviourForCards\(/g)?.length).toBe(2);
    expect(src("src/components/report-card/report-card-sheet.tsx")).toMatch(/card\.behaviour/);
    expect(src("src/lib/pdf/report-card.ts")).toMatch(/card\.behaviour/);
  });
});

describe("a subject teacher can read the class they teach (0304)", () => {
  it("teaching_roster is a definer that filters by tenant itself and refuses in a sentence", () => {
    const { header, body } = latest("teaching_roster");
    expect(header).toMatch(/security definer/);
    expect(body).toMatch(/s\.tenant_id = v_tenant/);
    expect(body).toMatch(/e\.tenant_id = v_tenant/);
    expect(body).toMatch(/raise exception 'You can see the class list only for a class you teach\.'/);
    expect(SQL.map((s) => s.sql).join("\n")).toMatch(
      /revoke all on function public\.teaching_roster\(uuid, uuid\) from public, anon;/,
    );
  });

  it("the exam marks sheet takes its children from it, not from the caller's view of enrolments", () => {
    const { file, body } = latest("exams_mark_sheet");
    expect(file).toMatch(/^0304_/);
    expect(body).toMatch(/cross join lateral public\.teaching_roster\(es\.section_id, es\.subject_id\) r/);
    expect(body).not.toMatch(/public\.enrolments/);
    // 0285's elective rule survived the rewrite.
    expect(body).toMatch(/public\.student_takes_subject\(r\.student_id/);
  });

  it("the enrolments policy was deliberately not widened (0201's fabricated coverage)", () => {
    const m = SQL.find((s) => s.f.startsWith("0304_"))!.sql;
    expect(m).not.toMatch(/on public\.enrolments/);
  });
});

describe("class tests", () => {
  it("a test's date is held to its class's year, by the year's real columns (0305)", () => {
    const { file, body } = latest("class_test_create");
    expect(file).toMatch(/^0305_/);
    expect(body).toMatch(/p_held_on < v_year\.start_date or p_held_on > v_year\.end_date/);
    expect(body).not.toMatch(/v_year\.starts_on/);
  });

  it("a mark carries its test's maximum and year in one key (0306)", () => {
    const m0304 = SQL.find((s) => s.f.startsWith("0304_"))!.sql;
    const m0306 = SQL.find((s) => s.f.startsWith("0306_"))!.sql;
    expect(m0306).toMatch(/alter table public\.class_test_marks add column session_id uuid not null;/);
    expect(m0306).toMatch(
      /foreign key \(tenant_id, test_id, max_marks, session_id\)\s+references public\.class_tests \(tenant_id, id, max_marks, session_id\)\s+on update cascade/,
    );
    expect(m0304).toMatch(/foreign key \(tenant_id, session_id, section_id, subject_id\)\s+references public\.section_subjects/);
  });

  it("an undo counts behaviour grades and class test marks (0306)", () => {
    const { file, body } = latest("promotion_undo");
    // 0306 or a later redefinition (0345 added staff ratings) -- the rows are the point.
    expect(Number(file.slice(0, 4))).toBeGreaterThanOrEqual(306);
    expect(body).toMatch(/\('behaviour_ratings', 'created_at'/);
    expect(body).toMatch(/\('class_test_marks', 'created_at'/);
  });

  it("the save sends the test's year, which the key then holds it to", () => {
    expect(src("src/app/(app)/class-tests/actions.ts")).toMatch(/session_id: test\.session_id,/);
  });

  it("no policy uses exams.view, and the family policies on marks never reach class_tests (no recursion)", () => {
    for (const p of [...policies("class_tests"), ...policies("class_test_marks")]) {
      expect(p.text, p.name).not.toMatch(/exams\.view/);
    }
    for (const p of policies("class_test_marks").filter((p) => /(students|guardians) view/.test(p.name))) {
      expect(p.text, p.name).not.toMatch(/class_tests/);
    }
  });

  it("a cell is a number, AB, or blank", () => {
    expect(parseCell("17")).toEqual({ marks: 17, absent: false });
    expect(parseCell(" ab ")).toEqual({ marks: null, absent: true });
    expect(parseCell("")).toEqual({ marks: null, absent: false });
    expect(parseCell("7.5")).toEqual({ marks: 7.5, absent: false });
    expect(parseCell("seven")).toBe("invalid");
    expect(formatCell({ marks: null, absent: true })).toBe("AB");
  });

  it("saving writes what changed, deletes what was cleared, and refuses a mark over the maximum", () => {
    const before = [
      { studentId: "a", marks: 10, absent: false },
      { studentId: "b", marks: 12, absent: false },
    ];
    const plan = planTestMarks(
      before,
      [
        { studentId: "a", marks: 10, absent: false },
        { studentId: "b", marks: null, absent: false },
        { studentId: "c", marks: null, absent: true },
      ],
      20,
    );
    expect(plan).toEqual({ ok: true, upserts: [{ studentId: "c", marks: null, absent: true }], deletes: ["b"] });
    expect(planTestMarks([], [{ studentId: "a", marks: 21, absent: false }], 20)).toEqual({
      ok: false,
      error: "A mark must be between 0 and 20.",
    });
  });

  it("the page chooses its screen by tier, never by role codes", () => {
    const page = src("src/app/(app)/class-tests/page.tsx");
    expect(page).toMatch(/ctx\?\.roleTier === "student"/);
    expect(page).not.toMatch(/roleCode/);
  });
});

describe("the behaviour scale is the college's (0307)", () => {
  it("a missing or malformed setting reads as CBSE's five points", () => {
    for (const v of [null, undefined, {}, "x", { points: "lots" }]) {
      expect(parseScale(v).grades).toEqual(["A", "B", "C", "D", "E"]);
    }
    expect(scaleLegend(parseScale(null))).toBe(
      "A Outstanding · B Very good · C Good · D Fair · E Needs improvement",
    );
  });

  it("clamps to three to five points and keeps the college's own words", () => {
    expect(parseScale({ points: 3, A: "Excellent" })).toEqual({
      grades: ["A", "B", "C"],
      meaning: { A: "Excellent", B: "Very good", C: "Good" },
    });
    expect(parseScale({ points: 9 }).grades).toHaveLength(5);
    expect(parseScale({ points: 1 }).grades).toHaveLength(3);
    // A blank word is not a word; the default stands.
    expect(parseScale({ points: 4, D: "  " }).meaning.D).toBe("Fair");
  });

  it("the database holds new grades to the scale, and never refuses an unchanged one", () => {
    const m = SQL.find((s) => s.f.startsWith("0307_"))!.sql;
    expect(m).toMatch(/before insert or update of grade on public\.behaviour_ratings/);
    const { body } = latest("behaviour_ratings_in_scale");
    // A publish cascades exam_status onto every row; that must not be refused.
    expect(body).toMatch(/if tg_op = 'UPDATE' and new\.grade = old\.grade then\s+return new;/);
    expect(body).toMatch(/left\('ABCDE', v_points\)/);
  });

  it("the setting is declared, so /settings can edit it, gated on exams.manage", () => {
    const m = SQL.find((s) => s.f.startsWith("0307_"))!.sql;
    expect(m).toMatch(/'exams\.behaviour_scale',/);
    expect(m).toMatch(/'exams\.manage',\s*85/);
  });

  it("the grid offers the scale's letters and every report card prints the scale's words", () => {
    expect(src("src/app/(app)/exams/[examId]/behaviour/behaviour-grid.tsx")).toMatch(/scale\.grades\.map\(/);
    const actions = src("src/app/(app)/exams/report-card-actions.ts");
    expect(actions.match(/getBehaviourScale\(\)/g)?.length).toBe(2);
    expect(actions.match(/card\.behaviour_legend = /g)?.length).toBe(2);
    expect(src("src/components/report-card/report-card-sheet.tsx")).toMatch(/card\.behaviour_legend/);
    expect(src("src/lib/pdf/report-card.ts")).toMatch(/card\.behaviour_legend/);
  });
});

describe("class tests have a report and a place on the record (0307)", () => {
  it("the report is an invoker with no hand-written tenant filter, and a total order for paging", () => {
    const { header, body } = latest("report_class_tests");
    expect(header).not.toMatch(/security definer/);
    expect(body).not.toMatch(/tenant_id\s*=/);
    expect(body).toMatch(/order by ct\.held_on desc, ct\.id, p\.first_name, p\.last_name, m\.student_id/);
    // Not enrolments: a subject teacher reads only their own class's.
    expect(body).not.toMatch(/public\.enrolments/);
  });

  it("is catalogued for staff, on exams.grade, never exams.view", () => {
    const m = SQL.find((s) => s.f.startsWith("0307_"))!.sql;
    expect(m).toMatch(/'classtests\.marks', 'Class test marks'/);
    expect(m).toMatch(/'Exams', 'exams\.grade', 'report_class_tests'/);
    expect(m).toMatch(/36, 'staff'/);
    expect(m).toMatch(/"href": "\/class-tests\/\{test_id\}"/);
  });

  it("the student record shows recent marks through the same action the family screen uses", () => {
    const page = src("src/app/(app)/students/[id]/page.tsx");
    expect(page).toMatch(/myChildrenTestMarks\(id, 8\)/);
    expect(page).toMatch(/testMarks\.length > 0 &&/);
  });
});

describe("the new screens speak the reader's language", () => {
  const FILES = [
    "src/app/(app)/calendar/page.tsx",
    "src/app/(app)/class-tests/page.tsx",
    "src/app/(app)/class-tests/new-test-dialog.tsx",
    "src/app/(app)/class-tests/[testId]/page.tsx",
    "src/app/(app)/class-tests/[testId]/test-sheet.tsx",
    "src/app/(app)/exams/[examId]/behaviour/page.tsx",
    "src/app/(app)/exams/[examId]/behaviour/behaviour-grid.tsx",
    "src/app/(app)/exams/[examId]/behaviour/traits-editor.tsx",
    "src/app/(app)/students/[id]/admitted/page.tsx",
  ];

  /**
   * A heading, a column title or a button written as bare English text in JSX.
   * Generous by design: it looks for a capitalised English word between `>`
   * and `<`, which is how every one of these screens first shipped.
   */
  it.each(FILES)("%s draws no bare English text", (file) => {
    const code = src(file);
    const bare = [...code.matchAll(/>\s*([A-Z][a-z]+(?: [a-z']+)+)\s*</g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });
});
