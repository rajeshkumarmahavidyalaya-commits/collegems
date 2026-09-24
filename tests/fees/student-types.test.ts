import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  byClass,
  effectiveFees,
  effectiveTotal,
  studentTypeCode,
  type FeeRow,
} from "@/lib/validations/student-types";

/**
 * Fees by kind of student (migration 0281). The screen's `effectiveFees` is a
 * copy of the rule `fees_billable_lines` bills by, so both halves are pinned
 * here to the numbers probed on the demo college: a Grade 1 carry-over student
 * whose tuition was set to 999.00 and whose examination fee was set to 0.
 */

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function sql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const ALL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => sql(readFileSync(join(MIGRATIONS, f), "utf8")))
  .join("\n");

function functionBody(name: string): string {
  let found = "";
  const pattern = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(ALL)) !== null) {
    const rest = ALL.slice(m.index);
    found = rest.slice(0, rest.search(/\n\$(?:function)?\$;/));
  }
  return found;
}

const CO = "carry-over-id";
const row = (feeHead: string, amount: number, studentTypeId: string | null = null): FeeRow => ({
  id: `${feeHead}-${studentTypeId ?? "all"}`,
  amount,
  frequency: "annual",
  classLevelId: "g1",
  classLevel: "Grade 1",
  sequence: 1,
  feeHeadId: feeHead,
  feeHead,
  feeHeadCode: feeHead,
  studentTypeId,
  studentType: studentTypeId ? "Carry-over" : null,
});

/** The demo college's Grade 1, as probed, with the two carry-over rows added. */
const GRADE_1 = [
  row("Activity fee", 900),
  row("Examination fee", 1200),
  row("Library fee", 600),
  row("Tuition fee", 8700),
  row("Tuition fee", 999, CO),
  row("Examination fee", 0, CO),
];

describe("what a kind of student pays", () => {
  it("a regular student pays the untyped rows and nothing else", () => {
    const fees = effectiveFees(GRADE_1, null);
    expect(fees.map((f) => f.kind)).toEqual(["regular", "regular", "regular", "regular"]);
    expect(effectiveTotal(fees)).toBe(11400);
  });

  it("a carry-over student's own amount replaces the regular one; 0 exempts", () => {
    const fees = effectiveFees(GRADE_1, CO);
    const byHead = Object.fromEntries(fees.map((f) => [f.row.feeHead, f]));
    // Probed through fees_billable_lines: Tuition fee (Carry-over)=999.00,
    // no Examination fee line, Activity and Library unchanged.
    expect(byHead["Tuition fee"].kind).toBe("own");
    expect(byHead["Tuition fee"].row.amount).toBe(999);
    expect(byHead["Tuition fee"].regularAmount).toBe(8700);
    expect(byHead["Examination fee"].kind).toBe("exempt");
    expect(byHead["Activity fee"].kind).toBe("inherited");
    expect(effectiveTotal(fees)).toBe(2499);
    // Replaces, never adds: 8,700 + 999 would be the bug.
    expect(effectiveTotal(fees)).not.toBe(2499 + 8700);
    expect(fees).toHaveLength(4);
  });

  it("a head only one kind of student pays still shows for them", () => {
    const fees = effectiveFees([...GRADE_1, row("Back paper fee", 500, CO)], CO);
    expect(fees.find((f) => f.row.feeHead === "Back paper fee")?.kind).toBe("own");
    expect(effectiveFees([...GRADE_1, row("Back paper fee", 500, CO)], null)).toHaveLength(4);
  });

  it("groups by class id, so two classes with one name are two cards", () => {
    const twin = { ...row("Tuition fee", 1), classLevelId: "g1b" };
    expect(byClass([...GRADE_1, twin]).map((g) => g.classLevelId)).toEqual(["g1", "g1b"]);
  });
});

describe("the SQL says the same thing", () => {
  const billable = functionBody("fees_billable_lines");

  it("replaces the untyped row for the child's own type, read for this year", () => {
    expect(billable).toMatch(/fs\.student_type_id is null\s+and not exists \(/);
    expect(billable).toMatch(/o\.fee_head_id = fs\.fee_head_id\s+and o\.student_type_id = \(/);
    // The type is a fact about a year: read for the current session.
    expect(billable.match(/from public\.student_type_assignments a/g)).toHaveLength(2);
    expect(billable.match(/and a\.session_id = public\.current_session_id\(public\.current_tenant_id\(\)\)/g)).toHaveLength(2);
    // An exemption is an amount of 0, filtered after the override is chosen.
    expect(billable).toMatch(/and fs\.amount > 0/);
    // A family reading a larger bill sees why.
    expect(billable).toMatch(/fh\.name \|\| coalesce\(' \(' \|\| st\.name \|\| '\)', ''\)/);
  });

  it("keeps one untyped row per class and head, and copies typed rows forward", () => {
    expect(ALL).toMatch(
      /unique nulls not distinct \(tenant_id, session_id, class_level_id, fee_head_id, student_type_id\)/,
    );
    expect(functionBody("fees_roll_forward_structures")).toMatch(
      /on conflict \(tenant_id, session_id, class_level_id, fee_head_id, student_type_id\) do nothing/,
    );
    const actions = readFileSync(join(ROOT, "src/app/(app)/fees/actions.ts"), "utf8");
    expect(actions).toContain('onConflict: "tenant_id,session_id,class_level_id,fee_head_id,student_type_id"');
  });

  it("who is which kind is readable by finance roles and nobody else", () => {
    const policies = [...ALL.matchAll(/create policy "([^"]+)" on public\.student_type_assignments[\s\S]*?;/g)];
    expect(policies.map((p) => p[1])).toEqual(["finance roles manage student_type_assignments"]);
    expect(policies[0][0]).toMatch(/array\['admin', 'accountant'\]/);
    expect(policies[0][0]).not.toMatch(/parent|student'|teacher/);
  });

  it("the student page draws the control on the permission those roles hold", () => {
    const page = readFileSync(join(ROOT, "src/app/(app)/students/[id]/page.tsx"), "utf8");
    expect(page).toContain('hasPermission("fees.collect")');
    // And reads this year's enrolment, not whichever the join returned first.
    expect(page).toMatch(/enrolments\.find\(\(e\) => e\.session_id === ctx\?\.currentSessionId\)/);
  });
});

describe("a code for a kind of student", () => {
  const CHECK = /^[a-z][a-z0-9_]{1,39}$/;
  it.each([
    ["Carry-over", "carry_over"],
    ["Management quota", "management_quota"],
    ["2nd attempt", "t_2nd_attempt"],
    ["!!", "t_type"],
    ["हिन्दी", "t_type"],
    ["x", "x_type"],
  ])("%s -> %s, which the CHECK accepts", (name, code) => {
    expect(studentTypeCode(name)).toBe(code);
    expect(studentTypeCode(name)).toMatch(CHECK);
  });

  it("never exceeds the column's length", () => {
    expect(studentTypeCode("a".repeat(200)).length).toBeLessThanOrEqual(40);
    expect(studentTypeCode("a".repeat(200))).toMatch(CHECK);
  });
});
