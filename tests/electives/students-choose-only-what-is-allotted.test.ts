import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { choiceRule, parseMySubjects, progressSentence, selectionProblem } from "@/lib/validations/electives";

/**
 * Elective choice (migration 0282). A student sees only the subjects allotted
 * to their own class, and can only save those. Three mechanisms make that true
 * and each is one line somebody could tidy away, so each is pinned here.
 */

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0282_students_choose_their_electives.sql"), "utf8")
  .replace(/--.*$/gm, "");

describe("a student chooses only what was allotted", () => {
  it("gives students no write policy on their choices", () => {
    // The absence is the mechanism: subject_choice_save checks the window, the
    // class and the count, and a student insert policy would route around all three.
    const policies = [...SQL.matchAll(/create policy "[^"]+" on public\.student_subject_choices\s+for (\w+)[\s\S]*?;/g)];
    const studentWrites = policies.filter(
      (m) => m[1] !== "select" && /current_role_code\(\)\)?\s*=\s*'(student|parent)'/.test(m[0]),
    );
    expect(policies.length).toBeGreaterThan(0);
    expect(studentWrites).toEqual([]);
  });

  it("keeps a choice inside the group's allotment by foreign key", () => {
    expect(SQL).toMatch(
      /foreign key \(group_id, subject_id\) references public\.subject_group_options \(group_id, subject_id\)/,
    );
    expect(SQL).toMatch(
      /foreign key \(tenant_id, session_id, student_id\) references public\.enrolments \(tenant_id, session_id, student_id\)/,
    );
  });

  it("resolves the student from the login, never from the browser, for a student", () => {
    expect(SQL).toMatch(/You can only choose your own subjects/);
    expect(SQL).toMatch(/revoke all on function public\.subject_choice_save\(uuid, uuid\[\], uuid\) from public, anon;/);
    const action = readFileSync(join(process.cwd(), "src/app/(app)/my-subjects/actions.ts"), "utf8");
    // The student's own save never names a student: the function takes them
    // from the login. (The read beside it may name one -- RLS decides whose.)
    const save = action.slice(action.indexOf("export async function saveMyChoice"));
    const saveBody = save.slice(0, save.indexOf("\n}\n") + 2);
    expect(saveBody).toMatch(/subject_choice_save/);
    expect(saveBody).not.toMatch(/p_student_id/);
  });
});

describe("what the screens say", () => {
  it("states the rule once, with agreement", () => {
    expect(choiceRule(1, 1)).toBe("Choose 1 subject");
    expect(choiceRule(2, 2)).toBe("Choose 2 subjects");
    expect(choiceRule(0, 3)).toBe("Choose up to 3 subjects");
    expect(choiceRule(1, 2)).toBe("Choose 1 to 2 subjects");
  });

  it("names what stops a save", () => {
    expect(selectionProblem(0, 1, 2)).toBe("Choose 1 more subject.");
    expect(selectionProblem(3, 1, 2)).toBe("Only 2 can be chosen. Untick 1.");
    expect(selectionProblem(2, 1, 2)).toBeNull();
  });

  it("agrees number in the whole sentence", () => {
    expect(progressSentence(0, 1)).toBe("None of 1 student has chosen yet");
    expect(progressSentence(1, 60)).toBe("1 of 60 students have chosen");
    expect(progressSentence(60, 60)).toBe("All 60 students have chosen");
    expect(progressSentence(0, 0)).toBe("Nobody is enrolled in this class this year");
  });

  it("reads a student who is not enrolled as not enrolled", () => {
    expect(parseMySubjects({ enrolled: false })).toEqual({ enrolled: false });
    expect(parseMySubjects(null)).toEqual({ enrolled: false });
  });
});
