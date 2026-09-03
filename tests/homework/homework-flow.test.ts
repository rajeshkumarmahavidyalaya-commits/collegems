import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Homework, against a real class.
 *
 * The properties worth pinning are the ones that are *absences* in the schema
 * and would therefore survive a careless migration unnoticed:
 *
 *   - Publishing creates a row per enrolled student, so "not handed in" is a
 *     row rather than the absence of one.
 *   - `homework_submissions` has **no student UPDATE policy at all**. That
 *     absence is what stops a child writing their own mark, and it cannot be
 *     replaced by a column grant, because a grant is role-wide and would take
 *     `marks_obtained` away from the teachers too.
 *   - The maximum is carried on the submission by a composite foreign key, so
 *     a mark above it is refused by Postgres and lowering the maximum below an
 *     awarded mark is refused by the cascade.
 *
 * Everything created here is deleted in `afterAll`: the demo cohort is shared
 * with every other suite.
 */
describe("homework", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  let tenantId: string;
  let sessionId: string;
  let sectionId: string;
  let subjectId: string;
  let enrolledCount: number;

  const createdHomework: string[] = [];

  async function newHomework(overrides: Record<string, unknown> = {}) {
    const { data, error } = await a
      .from("homework")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        section_id: sectionId,
        subject_id: subjectId,
        title: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        due_on: "2030-01-31",
        assigned_on: "2030-01-01",
        ...overrides,
      })
      .select("id")
      .single();

    expect(error, error?.message).toBeNull();
    createdHomework.push(data!.id);
    return data!.id;
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: profile } = await a.from("user_profiles").select("tenant_id").single();
    tenantId = profile!.tenant_id;

    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();
    sessionId = session!.id;

    // Any (class, subject) the curriculum actually has: the composite foreign
    // key on `homework` refuses every other pair.
    const { data: curriculum } = await a
      .from("section_subjects")
      .select("section_id, subject_id")
      .eq("session_id", sessionId)
      .limit(1);

    expect(curriculum?.length, "the demo tenant needs at least one section_subject").toBe(1);
    sectionId = curriculum![0].section_id;
    subjectId = curriculum![0].subject_id;

    const { count } = await a
      .from("enrolments")
      .select("id", { count: "exact", head: true })
      .eq("section_id", sectionId)
      .eq("session_id", sessionId)
      .eq("status", "active");

    enrolledCount = count ?? 0;
    expect(enrolledCount).toBeGreaterThan(0);
  });

  afterAll(async () => {
    for (const id of createdHomework) {
      await a.from("homework").delete().eq("id", id);
    }
  });

  it("starts as a draft that nobody has been set", async () => {
    const id = await newHomework();

    const { data } = await a
      .from("homework")
      .select("status, published_at")
      .eq("id", id)
      .single();

    expect(data!.status).toBe("draft");
    expect(data!.published_at).toBeNull();

    const { count } = await a
      .from("homework_submissions")
      .select("id", { count: "exact", head: true })
      .eq("homework_id", id);

    expect(count).toBe(0);
  });

  it("publishing creates one pending row per enrolled student", async () => {
    const id = await newHomework();

    const { data: created, error } = await a.rpc("homework_publish", { p_homework_id: id });
    expect(error, error?.message).toBeNull();
    expect(created).toBe(enrolledCount);

    const { data: rows } = await a
      .from("homework_submissions")
      .select("status, submitted_at")
      .eq("homework_id", id);

    expect(rows).toHaveLength(enrolledCount);
    // "Not handed in" is a row, and a pending row never carries a time --
    // that pairing is `homework_submissions_submitted_chk`.
    for (const row of rows ?? []) {
      expect(row.status).toBe("pending");
      expect(row.submitted_at).toBeNull();
    }
  });

  it("refuses a second publish, and leaves the roll exactly as it was", async () => {
    const id = await newHomework();
    await a.rpc("homework_publish", { p_homework_id: id });

    const { error } = await a.rpc("homework_publish", { p_homework_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("already published");

    const { count } = await a
      .from("homework_submissions")
      .select("id", { count: "exact", head: true })
      .eq("homework_id", id);

    expect(count).toBe(enrolledCount);
  });

  it("propagates the maximum onto every submission, so the CHECK has a local column", async () => {
    const id = await newHomework({ max_marks: 20 });
    await a.rpc("homework_publish", { p_homework_id: id });

    const { data: rows } = await a
      .from("homework_submissions")
      .select("max_marks")
      .eq("homework_id", id);

    for (const row of rows ?? []) expect(Number(row.max_marks)).toBe(20);
  });

  it("refuses a mark above the homework's maximum", async () => {
    const id = await newHomework({ max_marks: 20 });
    await a.rpc("homework_publish", { p_homework_id: id });

    const { data: rows } = await a
      .from("homework_submissions")
      .select("id")
      .eq("homework_id", id)
      .limit(1);

    const submissionId = rows![0].id;

    // Hand it in as the admin can (via the table, which admins own outright),
    // so there is something markable.
    await a
      .from("homework_submissions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", submissionId);

    const { error } = await a.rpc("homework_grade", {
      p_submission_id: submissionId,
      p_marks: 25,
      p_return: true,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("between 0 and 20");
  });

  it("marks and returns in one step", async () => {
    const id = await newHomework({ max_marks: 20 });
    await a.rpc("homework_publish", { p_homework_id: id });

    const { data: rows } = await a
      .from("homework_submissions")
      .select("id")
      .eq("homework_id", id)
      .limit(1);
    const submissionId = rows![0].id;

    await a
      .from("homework_submissions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", submissionId);

    const { error } = await a.rpc("homework_grade", {
      p_submission_id: submissionId,
      p_marks: 17.5,
      p_feedback: "Good working, check question 6.",
      p_return: true,
    });
    expect(error, error?.message).toBeNull();

    const { data: marked } = await a
      .from("homework_submissions")
      .select("status, marks_obtained, feedback, graded_at")
      .eq("id", submissionId)
      .single();

    expect(marked!.status).toBe("returned");
    expect(Number(marked!.marks_obtained)).toBe(17.5);
    expect(marked!.feedback).toContain("question 6");
    // `homework_submissions_graded_chk`: a marked row always carries a time.
    expect(marked!.graded_at).not.toBeNull();
  });

  it("refuses to lower the maximum below a mark already awarded", async () => {
    const id = await newHomework({ max_marks: 20 });
    await a.rpc("homework_publish", { p_homework_id: id });

    const { data: rows } = await a
      .from("homework_submissions")
      .select("id")
      .eq("homework_id", id)
      .limit(1);
    const submissionId = rows![0].id;

    await a
      .from("homework_submissions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", submissionId);
    await a.rpc("homework_grade", { p_submission_id: submissionId, p_marks: 18 });

    // The cascade rewrites the child's copy and the CHECK re-evaluates. The
    // refusal is the correct answer, not a side effect.
    const { error } = await a.from("homework").update({ max_marks: 10 }).eq("id", id);
    expect(error).not.toBeNull();
  });

  it("refuses to unpublish once work has come in", async () => {
    const id = await newHomework();
    await a.rpc("homework_publish", { p_homework_id: id });

    const { data: rows } = await a
      .from("homework_submissions")
      .select("id")
      .eq("homework_id", id)
      .limit(1);

    await a
      .from("homework_submissions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", rows![0].id);

    const { error } = await a.rpc("homework_unpublish", { p_homework_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("already been handed in");
  });

  it("unpublishes cleanly while nothing has been handed in", async () => {
    const id = await newHomework();
    await a.rpc("homework_publish", { p_homework_id: id });

    const { error } = await a.rpc("homework_unpublish", { p_homework_id: id });
    expect(error, error?.message).toBeNull();

    const { data } = await a.from("homework").select("status").eq("id", id).single();
    expect(data!.status).toBe("draft");
  });

  it("refuses to let a non-student hand work in", async () => {
    const id = await newHomework();
    await a.rpc("homework_publish", { p_homework_id: id });

    const { error } = await a.rpc("homework_submit", { p_homework_id: id });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Only a student");
  });

  it("keeps a homework's assignment on the curriculum", async () => {
    // A subject the class does not have on its curriculum. The composite
    // foreign key is what refuses it -- there is no application check.
    const { data: others } = await a
      .from("subjects")
      .select("id")
      .neq("id", subjectId)
      .limit(20);

    const { data: assigned } = await a
      .from("section_subjects")
      .select("subject_id")
      .eq("section_id", sectionId)
      .eq("session_id", sessionId);

    const taught = new Set((assigned ?? []).map((r) => r.subject_id));
    const untaught = (others ?? []).find((s) => !taught.has(s.id));
    if (!untaught) return; // every subject is on this class's curriculum

    const { error } = await a.from("homework").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      section_id: sectionId,
      subject_id: untaught.id,
      title: "should not save",
      assigned_on: "2030-01-01",
      due_on: "2030-01-31",
    });

    expect(error).not.toBeNull();
  });

  it("refuses a due date before the day it was set, in Postgres as well as the form", async () => {
    const { error } = await a.from("homework").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      section_id: sectionId,
      subject_id: subjectId,
      title: "backwards",
      assigned_on: "2030-01-31",
      due_on: "2030-01-01",
    });

    expect(error).not.toBeNull();
  });

  it("a study material item is a file or a link, never both and never neither", async () => {
    const neither = await a.from("study_material").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      title: "nothing behind it",
    });
    expect(neither.error).not.toBeNull();

    const both = await a.from("study_material").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      title: "both",
      storage_path: `${tenantId}/x/y.pdf`,
      bucket_id: "study-material",
      external_url: "https://example.org",
    });
    expect(both.error).not.toBeNull();
  });

  it("keeps the other tenant's homework invisible", async () => {
    const id = await newHomework();
    await a.rpc("homework_publish", { p_homework_id: id });

    const { data: leaked } = await b.from("homework").select("id").eq("id", id);
    expect(leaked ?? []).toEqual([]);

    const { data: leakedRows } = await b
      .from("homework_submissions")
      .select("id")
      .eq("homework_id", id);
    expect(leakedRows ?? []).toEqual([]);
  });
});
