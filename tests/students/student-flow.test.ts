import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Integration coverage for the students module, against the real database
 * through the real RLS policies. The rules being checked live in Postgres --
 * the three-row admission is atomic in a function, the one-enrolment-per-year
 * invariant is a unique index, and tenant scoping is a policy -- so testing
 * them anywhere but here would be testing a mock.
 */
describe("student admission flow", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let sectionId: string;
  let otherSectionId: string;
  const createdPersonIds: string[] = [];

  const suffix = Date.now().toString().slice(-8);
  const admissionNumber = `TEST-${suffix}`;

  function person(first: string) {
    return {
      first_name: first,
      last_name: "Testcase",
      gender: "undisclosed",
      phone: "+919999000111",
      city: "Lucknow",
    };
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: sections } = await a.from("sections").select("id").limit(2);
    sectionId = sections![0].id;
    otherSectionId = sections![1].id;
  });

  afterAll(async () => {
    // Deleting the person cascades to students and enrolments, so the demo
    // data is left exactly as the suite found it.
    for (const id of createdPersonIds) {
      await a.from("people").delete().eq("id", id);
    }
  });

  it("admits a student, creating person, student and enrolment together", async () => {
    const { data: student, error } = await a.rpc("admit_student", {
      p_person: person("Atomic"),
      p_admission_number: admissionNumber,
      p_section_id: sectionId,
      p_roll_number: "99",
    });

    expect(error).toBeNull();
    expect(student).toBeTruthy();
    createdPersonIds.push(student!.person_id);

    expect(student!.admission_number).toBe(admissionNumber);
    expect(student!.status).toBe("active");

    const { data: people } = await a
      .from("people")
      .select("first_name, last_name")
      .eq("id", student!.person_id)
      .single();
    expect(people!.first_name).toBe("Atomic");

    const { data: enrolment } = await a
      .from("enrolments")
      .select("section_id, roll_number, session_id, status")
      .eq("student_id", student!.id)
      .single();

    expect(enrolment!.section_id).toBe(sectionId);
    expect(enrolment!.roll_number).toBe("99");
    // The session is resolved server-side; the client never supplies it.
    expect(enrolment!.session_id).toBeTruthy();
    expect(enrolment!.status).toBe("active");
  });

  it("rejects a duplicate admission number", async () => {
    const { error } = await a.rpc("admit_student", {
      p_person: person("Duplicate"),
      p_admission_number: admissionNumber,
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  it("admits without a section, leaving the student unenrolled", async () => {
    const { data: student, error } = await a.rpc("admit_student", {
      p_person: person("Unenrolled"),
      p_admission_number: `${admissionNumber}-NE`,
    });

    expect(error).toBeNull();
    createdPersonIds.push(student!.person_id);

    const { count } = await a
      .from("enrolments")
      .select("id", { count: "exact", head: true })
      .eq("student_id", student!.id);

    expect(count).toBe(0);
  });

  it("moving a student updates this session's enrolment instead of adding one", async () => {
    const { data: student } = await a
      .from("students")
      .select("id, person_id, admission_date")
      .eq("admission_number", admissionNumber)
      .single();

    const { error } = await a.rpc("update_student", {
      p_student_id: student!.id,
      p_person: person("Atomic"),
      p_admission_number: admissionNumber,
      p_admission_date: student!.admission_date,
      p_status: "active",
      p_section_id: otherSectionId,
      p_roll_number: "07",
    });

    expect(error).toBeNull();

    const { data: enrolments } = await a
      .from("enrolments")
      .select("section_id, roll_number")
      .eq("student_id", student!.id);

    // One enrolment per (tenant, session, student) -- a move is an update.
    expect(enrolments).toHaveLength(1);
    expect(enrolments![0].section_id).toBe(otherSectionId);
    expect(enrolments![0].roll_number).toBe("07");
  });

  it("does not leak a tenant A student to a tenant B admin", async () => {
    const { data: visible } = await b
      .from("students")
      .select("id")
      .eq("admission_number", admissionNumber);

    expect(visible ?? []).toHaveLength(0);
  });

  it("does not let a tenant B admin update a tenant A student", async () => {
    const { data: student } = await a
      .from("students")
      .select("id, admission_date")
      .eq("admission_number", admissionNumber)
      .single();

    const { error } = await b.rpc("update_student", {
      p_student_id: student!.id,
      p_person: person("Hijacked"),
      p_admission_number: admissionNumber,
      p_admission_date: student!.admission_date,
      p_status: "expelled",
    });

    // The function looks the row up scoped to the caller's tenant, so from
    // tenant B it simply does not exist.
    expect(error).toBeTruthy();

    const { data: after } = await a
      .from("students")
      .select("status")
      .eq("id", student!.id)
      .single();

    expect(after!.status).toBe("active");
  });
});
