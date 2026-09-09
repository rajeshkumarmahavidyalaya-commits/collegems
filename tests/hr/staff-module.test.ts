import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The staff module, through real RLS.
 *
 * `staff_exit` shipped in migration `0176` and had no caller in the
 * application until `0194` — which is rule 6's "a correct write path nobody
 * can call is not a fix", and is why the guards `0191` put on
 * `timetable_set_entry` and `substitution_arrange` were protecting against a
 * status no screen could set.
 *
 * What is worth proving here is the gate and the atomicity: the roster is
 * gated on the **matrix** rather than on RLS (which is deliberately role-wide
 * on `staff`), and adding somebody writes two tables or neither.
 */
describe("the staff roster", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  /** Everything this suite creates, removed in `afterAll` whatever happened. */
  const created: string[] = [];
  const CODE = "TEST-STAFF-1";

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  afterAll(async () => {
    for (const id of created) {
      const { data } = await a.from("staff").select("person_id").eq("id", id).maybeSingle();
      await a.from("staff").delete().eq("id", id);
      // The person goes too: nothing else refers to somebody created and
      // removed inside one test run, and leaving them would slowly fill
      // `people` with test rows that look like staff who never existed.
      if (data?.person_id) await a.from("people").delete().eq("id", data.person_id);
    }
  });

  it("is bounded, and says the true total alongside the page", async () => {
    const { data, error } = await a.rpc("staff_roster", { p_limit: 2, p_offset: 0 });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeLessThanOrEqual(2);
    if ((data ?? []).length > 0) {
      // The window count is over the filtered set, not the page.
      expect(Number(data![0].total_count)).toBeGreaterThanOrEqual(data!.length);
    }
  });

  it("refuses a limit larger than the cap rather than honouring it", async () => {
    const { data, error } = await a.rpc("staff_roster", { p_limit: 100000 });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeLessThanOrEqual(200);
  });

  it("does not cross tenants", async () => {
    const [{ data: rosterA }, { data: staffB }] = await Promise.all([
      a.rpc("staff_roster", { p_limit: 200 }),
      b.from("staff").select("id"),
    ]);
    const idsB = new Set((staffB ?? []).map((r) => r.id));
    for (const row of rosterA ?? []) expect(idsB.has(row.staff_id)).toBe(false);
  });

  it("creates the person and the employment record together", async () => {
    const { data, error } = await a.rpc("staff_admit", {
      p_person: { first_name: "Test", last_name: "Staff", phone: "0000000000" },
      p_employee_code: CODE,
      p_designation: "Assistant Teacher",
      p_department: "Science",
    });
    expect(error).toBeNull();

    const row = data as unknown as { id: string; person_id: string; status: string };
    created.push(row.id);
    expect(row.status).toBe("active");

    const { data: person } = await a
      .from("people")
      .select("first_name")
      .eq("id", row.person_id)
      .maybeSingle();
    expect(person?.first_name).toBe("Test");
  });

  it("names the collision it hit, rather than reporting a constraint", async () => {
    const { error } = await a.rpc("staff_admit", {
      p_person: { first_name: "Another", last_name: "Person" },
      p_employee_code: CODE,
      p_designation: "Assistant Teacher",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("already used by somebody else");
  });

  it("returns one document for the record page, with the counts on it", async () => {
    if (created.length === 0) return;
    const { data, error } = await a.rpc("staff_record", { p_staff_id: created[0] });
    expect(error).toBeNull();

    const doc = data as unknown as {
      staff: { employee_code: string; status: string };
      person: { full_name: string };
      teaching: { lessons: number; subjects: number; class_teacher_of: unknown[] };
      library: unknown;
      away_today: boolean;
    };

    expect(doc.staff.employee_code).toBe(CODE);
    expect(doc.person.full_name).toBe("Test Staff");
    expect(doc.teaching.lessons).toBe(0);
    expect(doc.teaching.class_teacher_of).toEqual([]);
    // Somebody just added holds no library card, and `null` is the honest
    // answer — not an object with zeroes in it, which would read as a card
    // with no books out.
    expect(doc.library).toBeNull();
    expect(doc.away_today).toBe(false);
  });

  it("edits the person and the employment record in one call", async () => {
    if (created.length === 0) return;
    const { error } = await a.rpc("staff_update", {
      p_staff_id: created[0],
      p_person: { first_name: "Test", last_name: "Staff", phone: "1111111111" },
      p_employee_code: CODE,
      p_designation: "Senior Teacher",
      p_department: "Science",
    });
    expect(error).toBeNull();

    const { data } = await a.rpc("staff_record", { p_staff_id: created[0] });
    const doc = data as unknown as {
      staff: { designation: string };
      person: { phone: string };
    };
    expect(doc.staff.designation).toBe("Senior Teacher");
    expect(doc.person.phone).toBe("1111111111");
  });

  it("cannot write a leaving status through the edit path", async () => {
    if (created.length === 0) return;
    // `staff_update` takes no status argument at all, so the only way to try
    // is to name one — and PostgREST cannot resolve a function with an
    // argument it has not got. The absence is the mechanism, so this asserts
    // the absence rather than trusting the form not to send it.
    const { error } = await a.rpc("staff_update", {
      p_staff_id: created[0],
      p_person: { first_name: "Test", last_name: "Staff" },
      p_employee_code: CODE,
      p_designation: "Senior Teacher",
      p_status: "terminated",
    });
    expect(error).not.toBeNull();

    const { data } = await a.rpc("staff_record", { p_staff_id: created[0] });
    expect((data as unknown as { staff: { status: string } }).staff.status).toBe("active");
  });

  it("ends the employment, closes the card, and unassigns nothing it should not", async () => {
    if (created.length === 0) return;
    const { data, error } = await a.rpc("staff_exit", {
      p_staff_id: created[0],
      p_reason: "Written by the automated test suite",
      p_status: "resigned",
    });
    expect(error).toBeNull();

    const doc = data as unknown as {
      unassigned: { lessons: number; sections: number; subjects: number };
      closed: { library: number };
      outstanding: unknown[];
    };
    expect(doc.unassigned.lessons).toBe(0);
    // Nobody's card: zero closed, not an error. `closed` arrived in `0192`
    // because `staff_exit` had been counting this and throwing it away.
    expect(doc.closed.library).toBe(0);
    expect(doc.outstanding).toEqual([]);

    const { data: after } = await a.rpc("staff_record", { p_staff_id: created[0] });
    const record = after as unknown as { staff: { status: string; date_of_leaving: string } };
    expect(record.staff.status).toBe("resigned");
    expect(record.staff.date_of_leaving).not.toBeNull();
  });

  it("will not put somebody who has left back on the timetable", async () => {
    if (created.length === 0) return;
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
      p_teacher_staff_id: created[0],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("cannot be given a lesson");
  });
});
