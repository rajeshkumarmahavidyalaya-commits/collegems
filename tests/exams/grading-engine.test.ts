import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The grading engine, against real marks.
 *
 * These assertions are the module's specification. The evaluation order is the
 * part schools argue about and the part a second customer will discover is
 * wrong, so every step of it is pinned to an exact number here rather than
 * described in a comment:
 *
 *   grace before pass  ·  substitution after grace  ·  best-of after
 *   substitution  ·  an unmarked paper is never substituted away
 *
 * The suite builds its own exam with hand-chosen marks rather than leaning on
 * the demo seed, so each expected total can be checked on paper.
 */
describe("grading engine", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  let tenantAId: string;
  let sessionId: string;
  let sectionId: string;
  let examId: string;
  let schemeId: string;
  let studentId: string;

  /** subject code → exam_subject id */
  const papers = new Map<string, string>();

  const suffix = Date.now().toString().slice(-8);
  const examName = `Engine test ${suffix}`;
  const schemeName = `Engine scheme ${suffix}`;

  /** Grace 5 marks in 1 subject; an additional subject may replace a failure. */
  const rules = {
    grades: [
      { code: "A", min_percent: 80, point: 10 },
      { code: "B", min_percent: 60, point: 8 },
      { code: "C", min_percent: 40, point: 6 },
      { code: "F", min_percent: 0, point: 0, is_fail: true },
    ],
    pass: { aggregate_min_percent: 33 },
    grace: { max_marks: 5, max_subjects: 1 },
    aggregate: { method: "weighted" },
    optional_subject: { replaces_worst: true },
  };

  async function setMark(code: string, marks: number | null, isAbsent = false) {
    const { error } = await a.rpc("exams_enter_marks", {
      p_exam_subject_id: papers.get(code)!,
      p_entries: [{ student_id: studentId, marks_obtained: marks, is_absent: isAbsent }],
    });
    expect(error, `setting ${code}: ${error?.message}`).toBeNull();
  }

  async function breakdown() {
    const { data, error } = await a.rpc("exams_subject_breakdown", {
      p_exam_id: examId,
      p_student_id: studentId,
    });
    expect(error).toBeNull();
    return new Map((data ?? []).map((row) => [row.subject_code, row]));
  }

  async function result() {
    const { data, error } = await a.rpc("exams_result_sheet", { p_exam_id: examId });
    expect(error).toBeNull();
    return (data ?? []).find((r) => r.student_id === studentId)!;
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: profile } = await a.from("user_profiles").select("tenant_id").single();
    tenantAId = profile!.tenant_id;

    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();
    sessionId = session!.id;

    // A section with at least four subjects on its curriculum and a student on
    // its roll — enough to exercise grace, substitution and best-of together.
    const { data: assignments } = await a
      .from("section_subjects")
      .select("section_id, subject_id")
      .eq("session_id", sessionId);

    const bySection = new Map<string, string[]>();
    for (const row of assignments ?? []) {
      bySection.set(row.section_id, [...(bySection.get(row.section_id) ?? []), row.subject_id]);
    }

    const { data: enrolments } = await a
      .from("enrolments")
      .select("section_id, student_id")
      .eq("session_id", sessionId)
      .eq("status", "active");

    const usable = [...bySection.entries()].find(
      ([id, subjects]) =>
        subjects.length >= 4 && (enrolments ?? []).some((e) => e.section_id === id),
    );
    expect(usable, "the demo tenant needs a class with four subjects and a student").toBeDefined();

    sectionId = usable![0];
    studentId = (enrolments ?? []).find((e) => e.section_id === sectionId)!.student_id;

    const { data: scheme, error: schemeError } = await a
      .from("grading_schemes")
      .insert({ tenant_id: tenantAId, name: schemeName, rules, is_default: false })
      .select("id")
      .single();
    expect(schemeError).toBeNull();
    schemeId = scheme!.id;

    const { data: exam } = await a
      .from("exams")
      .insert({
        tenant_id: tenantAId,
        session_id: sessionId,
        name: examName,
        kind: "unit",
        grading_scheme_id: schemeId,
      })
      .select("id")
      .single();
    examId = exam!.id;

    const subjectIds = usable![1].slice(0, 4);
    const { data: subjects } = await a
      .from("subjects")
      .select("id, code")
      .in("id", subjectIds);

    // Three compulsory papers plus one additional, all out of 100 with a pass
    // mark of 33, so every expected number below is arithmetic anyone can check.
    for (const [index, subject] of (subjects ?? []).entries()) {
      const { data: paper, error } = await a
        .from("exam_subjects")
        .insert({
          tenant_id: tenantAId,
          session_id: sessionId,
          exam_id: examId,
          section_id: sectionId,
          subject_id: subject.id,
          max_marks: 100,
          pass_marks: 33,
          weight: 1,
          is_optional: index === 3,
        })
        .select("id")
        .single();
      expect(error, `creating paper ${subject.code}: ${error?.message}`).toBeNull();
      papers.set(subject.code, paper!.id);
    }

    expect(papers.size).toBe(4);
  });

  afterAll(async () => {
    // Deleting the exam cascades to its papers and their marks.
    if (examId) await a.from("exams").delete().eq("id", examId);
    if (schemeId) await a.from("grading_schemes").delete().eq("id", schemeId);
  });

  const codes = () => [...papers.keys()];

  it("counts every paper when nothing is special", async () => {
    const [c1, c2, c3, opt] = codes();
    await setMark(c1, 60);
    await setMark(c2, 70);
    await setMark(c3, 80);
    await setMark(opt, 50);

    const r = await result();

    // 60 + 70 + 80 = 210 of 300. The additional subject is excluded because
    // nothing failed, so there is nothing for it to replace.
    expect(Number(r.total_marks)).toBe(210);
    expect(Number(r.max_marks)).toBe(300);
    expect(Number(r.percentage)).toBeCloseTo(70, 3);
    expect(r.grade).toBe("B");
    expect(r.result).toBe("pass");
    expect(r.subjects_counted).toBe(3);
  });

  it("applies grace before deciding whether a subject passed", async () => {
    const [c1] = codes();
    await setMark(c1, 30); // three short of the pass mark, inside the allowance

    const rows = await breakdown();
    const paper = rows.get(c1)!;

    expect(Number(paper.grace_marks)).toBe(3);
    expect(Number(paper.effective_marks)).toBe(33);
    expect(paper.passed).toBe(true);
    expect(paper.note).toContain("Grace");

    const r = await result();
    // 33 + 70 + 80 = 183 of 300.
    expect(Number(r.total_marks)).toBe(183);
    expect(r.result).toBe("pass");
  });

  it("spends the allowance on the cheapest gap first", async () => {
    const [c1, c2] = codes();
    await setMark(c1, 30); // 3 short
    await setMark(c2, 29); // 4 short — both eligible, but only one may be graced

    const rows = await breakdown();

    // The smaller gap converts, because that is what maximises the number of
    // subjects the allowance rescues.
    expect(Number(rows.get(c1)!.grace_marks)).toBe(3);
    expect(rows.get(c1)!.passed).toBe(true);
    expect(Number(rows.get(c2)!.grace_marks)).toBe(0);
    expect(rows.get(c2)!.passed).toBe(false);
  });

  it("lets an additional subject stand in for a subject that is still failed", async () => {
    const [c1, c2, c3, opt] = codes();
    await setMark(c1, 60);
    await setMark(c2, 20); // beyond grace, genuinely failed
    await setMark(c3, 80);
    await setMark(opt, 50);

    const rows = await breakdown();

    expect(rows.get(c2)!.counted).toBe(false);
    expect(rows.get(c2)!.note).toContain("Replaced");
    expect(rows.get(opt)!.counted).toBe(true);
    expect(rows.get(opt)!.note).toContain("in place of");

    const r = await result();
    // 60 + 80 + 50 = 190 of 300; the failed paper is out, the additional in.
    expect(Number(r.total_marks)).toBe(190);
    expect(r.result).toBe("pass");
    expect(r.subjects_failed).toBe(0);
  });

  it("does not substitute an unmarked paper away — that is the incomplete case", async () => {
    // The bug migration 0049 fixed. A paper with no mark is not a failure, and
    // treating it as one let the additional subject cover it, reporting a
    // student as having PASSED an exam one of whose papers nobody had marked.
    const [c1, c2, c3, opt] = codes();
    await setMark(c1, 60);
    await setMark(c3, 80);
    await setMark(opt, 50);
    await a.from("marks").delete().eq("exam_subject_id", papers.get(c2)!).eq("student_id", studentId);

    const rows = await breakdown();
    expect(rows.get(c2)!.counted).toBe(true);
    expect(rows.get(c2)!.note).toContain("Not marked");
    expect(rows.get(opt)!.counted).toBe(false);

    const r = await result();
    expect(r.result).toBe("incomplete");
    expect(r.subjects_unmarked).toBe(1);
  });

  it("counts an absence against the student unless the scheme says otherwise", async () => {
    const [c1, c2, c3, opt] = codes();
    await setMark(c1, 60);
    await setMark(c2, null, true);
    await setMark(c3, 80);
    await setMark(opt, 50);

    const withDefault = await breakdown();
    expect(withDefault.get(c2)!.counted).toBe(true);
    expect(withDefault.get(c2)!.passed).toBe(false);
    expect((await result()).result).toBe("fail");

    // Turning the rule on is a change to a JSON document, not to code.
    await a
      .from("grading_schemes")
      .update({
        rules: {
          ...rules,
          optional_subject: { replaces_worst: true, replaces_absent: true },
        },
      })
      .eq("id", schemeId);

    try {
      const lenient = await breakdown();
      expect(lenient.get(c2)!.counted).toBe(false);
      expect((await result()).result).toBe("pass");
    } finally {
      await a.from("grading_schemes").update({ rules }).eq("id", schemeId);
    }
  });

  it("keeps only the best N when the scheme says best-of", async () => {
    const [c1, c2, c3, opt] = codes();
    await setMark(c1, 40);
    await setMark(c2, 60);
    await setMark(c3, 90);
    await setMark(opt, 70);

    await a
      .from("grading_schemes")
      .update({
        rules: { ...rules, aggregate: { method: "best_of", best_of: 2 } },
      })
      .eq("id", schemeId);

    try {
      const r = await result();
      // Nothing failed, so the additional subject stays out; best 2 of the
      // three compulsory papers are 90 and 60 = 150 of 200.
      expect(Number(r.total_marks)).toBe(150);
      expect(Number(r.max_marks)).toBe(200);
      expect(Number(r.percentage)).toBeCloseTo(75, 3);
      expect(r.subjects_counted).toBe(2);
    } finally {
      await a.from("grading_schemes").update({ rules }).eq("id", schemeId);
    }
  });

  it("gives no grade at all when the scheme has no bands, without failing", async () => {
    await a.from("grading_schemes").update({ rules: {} }).eq("id", schemeId);

    try {
      const r = await result();
      expect(r.grade).toBeNull();
      // An empty rules document is a straight weighted mean and a pass
      // threshold of zero, not an error.
      expect(Number(r.percentage)).toBeGreaterThan(0);
    } finally {
      await a.from("grading_schemes").update({ rules }).eq("id", schemeId);
    }
  });

  // -------------------------------------------------------------------------
  // The boundaries
  // -------------------------------------------------------------------------

  it("refuses a mark above the paper's maximum", async () => {
    const [c1] = codes();
    const { error } = await a.from("marks").upsert(
      {
        tenant_id: tenantAId,
        session_id: sessionId,
        exam_subject_id: papers.get(c1)!,
        student_id: studentId,
        marks_obtained: 150,
        max_marks: 100,
      },
      { onConflict: "tenant_id,exam_subject_id,student_id" },
    );

    // `marks.max_marks` is denormalised and held equal to the paper's by a
    // composite foreign key, so a CHECK can compare against it — which is how a
    // cross-table rule becomes a constraint rather than a trigger.
    expect(error).not.toBeNull();
  });

  it("refuses a mark and an absence on the same row", async () => {
    const [c1] = codes();
    const { error } = await a.from("marks").upsert(
      {
        tenant_id: tenantAId,
        session_id: sessionId,
        exam_subject_id: papers.get(c1)!,
        student_id: studentId,
        marks_obtained: 40,
        is_absent: true,
        max_marks: 100,
      },
      { onConflict: "tenant_id,exam_subject_id,student_id" },
    );

    expect(error).not.toBeNull();
  });

  it("refuses to lower a paper's maximum below a mark already awarded", async () => {
    const [c1] = codes();
    await setMark(c1, 90);

    const { error } = await a
      .from("exam_subjects")
      .update({ max_marks: 50 })
      .eq("id", papers.get(c1)!);

    // The composite FK cascades the new maximum onto the marks, the CHECK
    // re-evaluates, and it fails. That is the correct answer, not a side effect.
    expect(error).not.toBeNull();
  });

  it("freezes results on publish and refuses further marking", async () => {
    const [c1, c2, c3, opt] = codes();
    await setMark(c1, 60);
    await setMark(c2, 70);
    await setMark(c3, 80);
    await setMark(opt, 50);

    const { data: frozen, error } = await a.rpc("exams_publish", { p_exam_id: examId });
    expect(error).toBeNull();
    expect(frozen!).toBeGreaterThan(0);

    try {
      const { data: stored } = await a
        .from("exam_results")
        .select("total_marks, percentage, rules_snapshot")
        .eq("exam_id", examId)
        .eq("student_id", studentId)
        .single();

      expect(Number(stored!.total_marks)).toBe(210);
      // The rules as they stood, so a reprint matches the original even after
      // the scheme row is edited.
      expect(stored!.rules_snapshot).toMatchObject({ pass: { aggregate_min_percent: 33 } });

      const { error: markError } = await a.rpc("exams_enter_marks", {
        p_exam_subject_id: papers.get(c1)!,
        p_entries: [{ student_id: studentId, marks_obtained: 99 }],
      });
      expect(markError).not.toBeNull();
      expect(markError!.message).toContain("published");

      const { error: republish } = await a.rpc("exams_publish", { p_exam_id: examId });
      expect(republish).not.toBeNull();
      expect(republish!.message).toContain("already published");
    } finally {
      await a.rpc("exams_unpublish", { p_exam_id: examId });
    }
  });

  it("does not let anyone hand-write a result", async () => {
    // `exam_results` has no INSERT policy for any role at all: `exams_publish`
    // is SECURITY DEFINER and is the only writer, which is what makes the frozen
    // numbers worth trusting.
    const { error } = await a.from("exam_results").insert({
      tenant_id: tenantAId,
      session_id: sessionId,
      exam_id: examId,
      student_id: studentId,
      total_marks: 300,
      max_marks: 300,
      percentage: 100,
      result: "pass",
    });

    expect(error).not.toBeNull();
  });

  it("keeps one school's marks invisible to another", async () => {
    const [c1] = codes();

    const { data: leaked } = await b
      .from("marks")
      .select("id")
      .eq("exam_subject_id", papers.get(c1)!);
    expect(leaked).toEqual([]);

    const { data: sheet } = await b.rpc("exams_result_sheet", { p_exam_id: examId });
    expect(sheet ?? []).toEqual([]);

    const { data: exams } = await b.from("exams").select("id").eq("id", examId);
    expect(exams).toEqual([]);
  });
});
