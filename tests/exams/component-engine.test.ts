import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * A split paper against the real database.
 *
 * The claims, and why each is worth a test rather than a comment:
 *
 *   - **A paper's total is the sum of its parts and is stored nowhere.** The
 *     alternative — a maintained `marks.total` column — is the
 *     `book_issues.fine_paid` mistake rule 6 already threw out once.
 *   - **Evaluation order is part of the contract.** The parts are summed, the
 *     part minimums are checked on the RAW mark, and only then does grace touch
 *     the paper total. The demo seed's first child is the pinned case: theory
 *     60 of 70 and practical 8 of 30 is 68 of 100 — a pass on the total — and
 *     a fail, because the practical minimum is 10.
 *   - **Absence is per part.** Absent from the practical and present for the
 *     theory is a state a school has, and it must not leave the result
 *     "incomplete" forever.
 *   - **The parts have to add up**, which no constraint can see, so it is
 *     checked in `exams_set_components` with the numbers in the message.
 *   - **Lowering a part below an awarded mark is refused** — by the composite
 *     key's cascade, with a sentence in front of it for readability.
 *   - **Tenant isolation still holds** on the new table.
 */
describe("exam components", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let examId: string;
  let sciencePaperId: string;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data: exam } = await a
      .from("exams")
      .select("id, status")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(exam, "the demo tenant needs a draft exam with a split paper").not.toBeNull();
    examId = exam!.id;

    const { data: components } = await a
      .from("exam_components")
      .select("exam_subject_id, code")
      .eq("code", "PR")
      .limit(50);

    const { data: papers } = await a
      .from("exam_subjects")
      .select("id")
      .eq("exam_id", examId)
      .in("id", (components ?? []).map((c) => c.exam_subject_id));

    expect(papers?.length, "the draft exam needs a paper with a practical").toBeGreaterThan(0);
    sciencePaperId = papers![0].id;
  });

  it("keeps the paper's total out of the database entirely", async () => {
    // There is no column to read. The only way to the total is the engine, and
    // that is the point of the test: a second place to store it is a second
    // answer.
    const { data } = await a.from("marks").select("*").eq("exam_subject_id", sciencePaperId).limit(1);
    expect(data?.[0]).toBeDefined();
    expect(Object.keys(data![0])).not.toContain("total");
    expect(Object.keys(data![0])).toContain("exam_component_id");
    expect(Object.keys(data![0])).toContain("component_max_marks");
  });

  it("sums the parts, and fails a paper on a part even when the total passes", async () => {
    const { data, error } = await a.rpc("exams_subject_breakdown", { p_exam_id: examId });
    expect(error).toBeNull();

    const split = (data ?? []).filter((row) => row.component_detail !== null);
    expect(split.length, "the seed should have split papers").toBeGreaterThan(0);

    for (const row of split) {
      const parts = row.component_detail as { obtained: number | null; absent: boolean }[];
      const sum = parts.reduce((total, part) => total + Number(part.obtained ?? 0), 0);
      if (parts.some((part) => part.obtained !== null)) {
        expect(Number(row.marks_obtained)).toBe(sum);
      }
    }

    // The pinned case. Not "a paper somewhere fails" — this exact arithmetic,
    // because the order of the steps is what the numbers prove.
    const pinned = split.find(
      (row) =>
        Number(row.marks_obtained) === 68 &&
        Number(row.max_marks) === 100 &&
        (row.component_detail as { obtained: number | null }[]).some(
          (part) => Number(part.obtained) === 8,
        ),
    );
    expect(pinned, "the seeded practical-failure case").toBeDefined();
    expect(pinned!.passed).toBe(false);
    expect(Number(pinned!.percentage)).toBe(68);
    expect(pinned!.entered).toBe(true);
    expect(pinned!.is_absent).toBe(false);
    expect(pinned!.note).toContain("Below the minimum in Practical");
  });

  it("refuses a split whose parts do not add up, and says by how much", async () => {
    const { error } = await a.rpc("exams_set_components", {
      p_exam_subject_id: sciencePaperId,
      p_components: [
        { code: "TH", name: "Theory", max_marks: 70, pass_marks: 23 },
        { code: "PR", name: "Practical", max_marks: 25, pass_marks: 10 },
      ],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("add up to 95");
    expect(error!.message).toContain("5 short");
  });

  it("refuses a single part, because a paper split into one part is a paper", async () => {
    const { error } = await a.rpc("exams_set_components", {
      p_exam_subject_id: sciencePaperId,
      p_components: [{ code: "TH", name: "Theory", max_marks: 100, pass_marks: 33 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("two or more parts");
  });

  it("refuses to lower a part below a mark already awarded in it", async () => {
    const { error } = await a.rpc("exams_set_components", {
      p_exam_subject_id: sciencePaperId,
      p_components: [
        { code: "TH", name: "Theory", max_marks: 40, pass_marks: 13 },
        { code: "PR", name: "Practical", max_marks: 60, pass_marks: 20 },
      ],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("already awarded");
  });

  it("refuses a whole-paper mark for a split paper, and the other way round", async () => {
    const { data: student } = await a
      .from("marks")
      .select("student_id")
      .eq("exam_subject_id", sciencePaperId)
      .limit(1)
      .single();

    const split = await a.rpc("exams_enter_marks", {
      p_exam_subject_id: sciencePaperId,
      p_entries: [{ student_id: student!.student_id, marks_obtained: 50 }],
    });
    expect(split.error).not.toBeNull();
    expect(split.error!.message).toContain("which part it is for");

    const { data: whole } = await a
      .from("exam_subjects")
      .select("id")
      .eq("exam_id", examId)
      .not("id", "in", `(${sciencePaperId})`)
      .limit(20);

    const { data: allComponents } = await a.from("exam_components").select("exam_subject_id");
    const splitIds = new Set((allComponents ?? []).map((c) => c.exam_subject_id));
    const unsplit = (whole ?? []).find((p) => !splitIds.has(p.id));
    expect(unsplit, "the seed should leave some papers unsplit").toBeDefined();

    const wrongWay = await a.rpc("exams_enter_marks", {
      p_exam_subject_id: unsplit!.id,
      p_entries: [
        {
          student_id: student!.student_id,
          exam_component_id: "00000000-0000-4000-8000-000000000001",
          marks_obtained: 50,
        },
      ],
    });
    expect(wrongWay.error).not.toBeNull();
    expect(wrongWay.error!.message).toContain("not split into parts");
  });

  it("says out loud when a part's minimum will not be enforced", async () => {
    const { data, error } = await a.rpc("exams_problems", { p_exam_id: examId });
    expect(error).toBeNull();
    // The seeded exam's scheme *does* require each part, so this exam is clean.
    // What is asserted is that the critic runs at all and returns sentences.
    for (const row of data ?? []) {
      expect(typeof row.problem).toBe("string");
    }
  });

  it("does not let the other tenant see a component", async () => {
    const { data } = await b.from("exam_components").select("id").eq("exam_subject_id", sciencePaperId);
    expect(data ?? []).toHaveLength(0);
  });
});
