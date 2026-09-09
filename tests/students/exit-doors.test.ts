import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * An ending is not a door that stays shut.
 *
 * `student_exit` and `staff_exit` end the relationships somebody had. Until
 * migration `0191` neither stopped a new one being made the next morning, and
 * five doors were open — every one of them probed live before it was closed:
 *
 *   1. `members.status` stayed `active`, so `library_issue_book` handed a book
 *      to a child who had left. The exit function even *counts* their
 *      unreturned books to report them; it just never closed the card.
 *   2. The same door for staff.
 *   3. `concession_award` accepted a discount for the child whose concessions
 *      the exit had just revoked.
 *   4. `timetable_set_entry` accepted a teacher terminated thirty days ago —
 *      precisely the lessons `staff_exit` had finished unassigning.
 *   5. `substitution_arrange` never checked its substitute at all.
 *      `substitution_candidates` offers only active staff, but a list is a
 *      convenience and the function is the gate.
 *
 * These assert the refusals, in sentences, because a refusal nobody can read
 * is a refusal somebody works around.
 */
describe("an ending closes the doors it opened", () => {
  let a: SupabaseClient<Database>;

  let studentId = "";
  let memberId = "";
  let concessionId = "";
  let bookId = "";

  /** Everything changed, restored in `afterAll` whatever happened. */
  const restore = {
    enrolmentIds: [] as string[],
    transportIds: [] as string[],
    hostelIds: [] as string[],
    concessionIds: [] as string[],
  };

  beforeAll(async () => {
    a = await tenantAClient();

    // A child who is enrolled *and* holds a live library card, or none of this
    // proves anything.
    const { data: member } = await a
      .from("members")
      .select("id, student_id")
      .eq("status", "active")
      .not("student_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (!member?.student_id) return;
    memberId = member.id;
    studentId = member.student_id;

    const [{ data: enrolments }, { data: transport }, { data: hostel }, { data: concessions }] =
      await Promise.all([
        a.from("enrolments").select("id").eq("student_id", studentId).eq("status", "active"),
        a
          .from("transport_assignments")
          .select("id")
          .eq("student_id", studentId)
          .eq("status", "active")
          .is("ends_on", null),
        a
          .from("hostel_allocations")
          .select("id")
          .eq("student_id", studentId)
          .eq("status", "active")
          .is("ends_on", null),
        a
          .from("student_concessions")
          .select("id")
          .eq("student_id", studentId)
          .eq("status", "active"),
      ]);
    restore.enrolmentIds = (enrolments ?? []).map((r) => r.id);
    restore.transportIds = (transport ?? []).map((r) => r.id);
    restore.hostelIds = (hostel ?? []).map((r) => r.id);
    restore.concessionIds = (concessions ?? []).map((r) => r.id);

    const [{ data: concession }, { data: book }] = await Promise.all([
      a.from("fee_concessions").select("id").eq("is_active", true).limit(1).maybeSingle(),
      a.from("books").select("id").gt("available_copies", 0).limit(1).maybeSingle(),
    ]);
    concessionId = concession?.id ?? "";
    bookId = book?.id ?? "";
  });

  afterAll(async () => {
    if (!studentId) return;
    await a.from("students").update({ status: "active" }).eq("id", studentId);
    await a.from("members").update({ status: "active" }).eq("id", memberId);
    if (restore.enrolmentIds.length > 0) {
      await a.from("enrolments").update({ status: "active" }).in("id", restore.enrolmentIds);
    }
    if (restore.transportIds.length > 0) {
      await a.from("transport_assignments").update({ ends_on: null }).in("id", restore.transportIds);
    }
    if (restore.hostelIds.length > 0) {
      await a.from("hostel_allocations").update({ ends_on: null }).in("id", restore.hostelIds);
    }
    if (restore.concessionIds.length > 0) {
      await a
        .from("student_concessions")
        .update({ status: "active", revoked_at: null, revoked_by: null, revoke_reason: null })
        .in("id", restore.concessionIds);
    }
  });

  it("closes the library card as part of the ending, and says how many", async () => {
    if (!studentId) return;

    const { data, error } = await a.rpc("student_exit", {
      p_student_id: studentId,
      p_reason: "Written by the automated test suite",
      p_status: "transferred",
    });
    expect(error).toBeNull();

    const doc = data as unknown as { closed: Record<string, number> };
    expect(doc.closed.library).toBeGreaterThan(0);

    const { data: member } = await a
      .from("members")
      .select("status")
      .eq("id", memberId)
      .maybeSingle();

    // `expired`, not `suspended`: a suspension is something a librarian does
    // about behaviour, and this is a card that ran out because the child is no
    // longer here.
    expect(member?.status).toBe("expired");
  });

  it("refuses to issue a book to a child who has left", async () => {
    if (!studentId || !bookId) return;

    const { error } = await a.rpc("library_issue_book", {
      p_member_id: memberId,
      p_book_id: bookId,
    });

    // Asserted on the sentence, not merely on there being an error: any other
    // failure here — no copies, a borrowing limit — would pass a bare
    // `not.toBeNull()` while the door stayed open.
    expect(error).not.toBeNull();
    expect(error!.message).toContain("not active");
  });

  it("refuses to award a concession to a child who has left", async () => {
    if (!studentId || !concessionId) return;

    const { error } = await a.rpc("concession_award", {
      p_student_id: studentId,
      p_concession_id: concessionId,
      p_reason: "Written by the automated test suite",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("no bill to take a concession off");
  });
});

/**
 * The two staff doors. Separate `describe` because they need somebody who has
 * already left rather than somebody this suite made leave — `staff_exit` is
 * not reversible from the app, so the test finds a leaver instead of creating
 * one, and skips when a school has none.
 */
describe("a departed teacher cannot be put back on the roster", () => {
  let a: SupabaseClient<Database>;
  let goneStaffId = "";

  beforeAll(async () => {
    a = await tenantAClient();
    const { data } = await a
      .from("staff")
      .select("id")
      .neq("status", "active")
      .limit(1)
      .maybeSingle();
    goneStaffId = data?.id ?? "";
  });

  it("refuses them a lesson, naming the status", async () => {
    if (!goneStaffId) return;

    const [{ data: section }, { data: slot }, { data: subject }] = await Promise.all([
      a.from("sections").select("id").limit(1).maybeSingle(),
      a.from("time_slots").select("id").eq("schedulable", true).limit(1).maybeSingle(),
      a.from("subjects").select("id").limit(1).maybeSingle(),
    ]);
    if (!section || !slot || !subject) return;

    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: section.id,
      p_weekday: 3,
      p_time_slot_id: slot.id,
      p_subject_id: subject.id,
      p_teacher_staff_id: goneStaffId,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("cannot be given a lesson");
  });

  it("refuses them a class to cover", async () => {
    if (!goneStaffId) return;

    // An unassigned lesson: there is nobody to be away, so the arrangement
    // reaches the substitute check rather than failing before it.
    const { data: entry } = await a
      .from("timetable_entries")
      .select("id, weekday")
      .is("teacher_staff_id", null)
      .limit(1)
      .maybeSingle();
    if (!entry) return;

    const { data: today } = await a.rpc("mobile_today");
    const base = new Date(`${today as unknown as string}T00:00:00Z`);
    const isodow = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
    base.setUTCDate(base.getUTCDate() + ((entry.weekday - isodow + 7) % 7));

    const { error } = await a.rpc("substitution_arrange", {
      p_timetable_entry_id: entry.id,
      p_date: base.toISOString().slice(0, 10),
      p_substitute_staff_id: goneStaffId,
      p_note: "Written by the automated test suite",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("cannot cover a class");
  });
});
