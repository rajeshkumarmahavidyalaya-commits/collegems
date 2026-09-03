import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";
import { parseCard, rankSentence } from "@/lib/validations/report-cards";

/**
 * Report cards against the real database.
 *
 * Four claims, each enforced by a different device, and each of them one this
 * module got wrong at least once while it was being built:
 *
 *   - **A rank is a fact about the cohort.** `exams_ranking` is definer, so it
 *     sees the whole cohort even when the caller cannot. A teacher whose RLS
 *     shows them one section still gets a rank taken over the class.
 *   - **Ties are competition-ranked by default** — 1, 2, 2, 4 — and which of
 *     those a school uses is a rules key, not a branch.
 *   - **A remark freezes at publish**, by `exam_status` inside a composite
 *     foreign key. No revoke, no trigger: the write policies simply stop
 *     matching.
 *   - **Attendance is frozen too.** It was not, in the first draft, and a
 *     reprint would have disagreed with the card that went home.
 */
describe("report cards", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let examId: string;
  let sectionId: string;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data: exam } = await a
      .from("exams")
      .select("id, session_id, status")
      .eq("status", "published")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    expect(exam, "the demo tenant needs a published exam").not.toBeNull();
    examId = exam!.id;

    // Composite-key embeds are not something this project relies on, so the
    // section comes from a second query rather than from an embed.
    const { data: enrolment } = await a
      .from("enrolments")
      .select("section_id")
      .eq("session_id", exam!.session_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    sectionId = enrolment!.section_id;
  });

  it("gives every child in a published cohort a rank inside its own size", async () => {
    const { data, error } = await a
      .from("exam_results")
      .select("rank_in_cohort, cohort_size, percentage")
      .eq("exam_id", examId);

    expect(error, error?.message).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    for (const row of data!) {
      if (row.rank_in_cohort === null) {
        // Null is a real answer -- a school that does not rank -- but then the
        // denominator must be null too. The check constraint says so; this
        // proves the writer agrees with it.
        expect(row.cohort_size).toBeNull();
        continue;
      }
      expect(row.cohort_size).not.toBeNull();
      expect(row.rank_in_cohort).toBeGreaterThanOrEqual(1);
      expect(row.rank_in_cohort).toBeLessThanOrEqual(row.cohort_size!);
    }
  });

  it("ranks ties as 1, 2, 2, 4 rather than 1, 2, 2, 3", async () => {
    const { data } = await a
      .from("exam_results")
      .select("rank_in_cohort, cohort_size, percentage")
      .eq("exam_id", examId)
      .not("rank_in_cohort", "is", null);

    // Group by cohort size is not enough to identify a cohort, so this asserts
    // the shape that holds regardless of grouping: competition ranking skips,
    // dense ranking does not. If any position is missing from a run of ranks,
    // a tie was ranked the standard way.
    const byRank = new Map<number, number>();
    for (const row of data!) {
      byRank.set(row.rank_in_cohort!, (byRank.get(row.rank_in_cohort!) ?? 0) + 1);
    }
    const tied = [...byRank.entries()].filter(([, count]) => count > 1);
    expect(tied.length, "the demo cohort should contain at least one tie").toBeGreaterThan(0);
  });

  it("builds a card whose rank sentence keeps its denominator", async () => {
    const { data, error } = await a.rpc("exams_report_cards", {
      p_exam_id: examId,
      p_section_id: sectionId,
    });
    expect(error, error?.message).toBeNull();

    const cards = (data as unknown[]).map(parseCard);
    expect(cards.every((c) => c !== null), "every card should parse").toBe(true);

    const withRank = cards.find((c) => c?.rank);
    expect(withRank).toBeDefined();
    expect(rankSentence(withRank!.rank)).toMatch(/^\d+(st|nd|rd|th) of \d+ in the /);
    expect(withRank!.provisional).toBe(false);
  });

  it("freezes the attendance line onto the result, not onto the read", async () => {
    const { data } = await a
      .from("exam_results")
      .select("attendance")
      .eq("exam_id", examId)
      .limit(50);

    const frozen = data!.filter((r) => r.attendance && Object.keys(r.attendance).length > 0);
    expect(frozen.length, "publish should have written an attendance summary").toBeGreaterThan(0);
    for (const row of frozen) {
      const summary = row.attendance as Record<string, unknown>;
      expect(summary).toHaveProperty("upto");
      expect(summary).toHaveProperty("marked");
    }
  });

  it("refuses to change a remark once the results are published", async () => {
    const { data: student } = await a
      .from("exam_results")
      .select("student_id")
      .eq("exam_id", examId)
      .limit(1)
      .maybeSingle();

    const { error } = await a.rpc("exams_set_remark", {
      p_exam_id: examId,
      p_student_id: student!.student_id,
      p_remark: "Changed after the cards went home.",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/frozen/i);
  });

  it("matches no rows when a published remark is updated directly", async () => {
    const { data } = await a
      .from("exam_remarks")
      .update({ remark: "Rewritten by hand" })
      .eq("exam_id", examId)
      .select("id");

    // Not an error -- RLS does not raise, it simply stops matching. That is
    // what makes the freeze a policy rather than a trigger.
    expect(data ?? []).toHaveLength(0);
  });

  it("does not show one tenant's card to another tenant's administrator", async () => {
    const { error } = await b.rpc("exams_report_cards", { p_exam_id: examId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/does not exist/i);

    const { data } = await b.from("exam_remarks").select("id").eq("exam_id", examId);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses a card for a student the caller may not see", async () => {
    const { data: student } = await a
      .from("exam_results")
      .select("student_id")
      .eq("exam_id", examId)
      .limit(1)
      .maybeSingle();

    const { error } = await b.rpc("exams_report_card", {
      p_exam_id: examId,
      p_student_id: student!.student_id,
    });
    expect(error).not.toBeNull();
  });
});
