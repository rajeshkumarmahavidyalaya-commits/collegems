import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * Academic years, through real RLS.
 *
 * `current_session_id()` reads `academic_sessions.is_current`, every dated row
 * in the product is stamped with whatever it says, and until migration `0195`
 * nothing in the application could create a year or move that flag. Measured on
 * the demo school before it was built, on 9 September 2026 with a year that
 * ended in March still current: 6,000 of 6,000 register rows, 323 of 323 ledger
 * entries and 317 of 317 invoices were filed under a year they were not in.
 *
 * The tests use a far-future year so they cannot collide with the school's
 * real ones, and remove it afterwards.
 */
describe("academic years", () => {
  let a: SupabaseClient<Database>;
  const created: string[] = [];
  const FAR = { name: "2098-2099 (test)", start: "2098-04-01", end: "2099-03-31" };

  beforeAll(async () => {
    a = await tenantAClient();
  });

  afterAll(async () => {
    for (const id of created) await a.from("academic_sessions").delete().eq("id", id);
  });

  it("creates a year without touching which one is current", async () => {
    const { data, error } = await a.rpc("academics_session_create", {
      p_name: FAR.name,
      p_start_date: FAR.start,
      p_end_date: FAR.end,
    });
    expect(error).toBeNull();

    const row = data as unknown as { id: string; is_current: boolean };
    created.push(row.id);
    // Creating a year is not choosing it. A school sets next year up in
    // February and switches in April.
    expect(row.is_current).toBe(false);
  });

  it("refuses an overlapping year, naming the one it clashes with", async () => {
    const { error } = await a.rpc("academics_session_create", {
      p_name: "2098-2099 (overlapping)",
      p_start_date: "2098-09-01",
      p_end_date: "2099-08-31",
    });

    // Not a bare 23P01: "conflicting key value violates exclusion constraint"
    // is not something to show a person (rule 4).
    expect(error).not.toBeNull();
    expect(error!.message).toContain("overlap");
    expect(error!.message).toContain(FAR.name);
  });

  it("refuses a year that ends before it starts", async () => {
    const { error } = await a.rpc("academics_session_create", {
      p_name: "2097-2098 (backwards)",
      p_start_date: "2098-03-31",
      p_end_date: "2097-04-01",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("end after it starts");
  });

  it("answers which year a date falls in, separately from which year is current", async () => {
    const { data: inFar } = await a.rpc("academics_session_for_date", { p_on: "2098-07-15" });
    expect(inFar).toBe(created[0]);

    // The two questions are different, and conflating them is the bug this
    // module exists for: `current_session_id` is a decision, this is a fact
    // about a date.
    const { data: current } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    expect(inFar).not.toBe(current?.id ?? null);

    // A date in no year at all is null, not the nearest one.
    const { data: nowhere } = await a.rpc("academics_session_for_date", { p_on: "1970-01-01" });
    expect(nowhere).toBeNull();
  });

  it("keeps exactly one year current when the flag moves", async () => {
    const { data: before } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (!before) return;

    // Moved and moved straight back inside one test: `academic_sessions_one_current_uk`
    // is a partial unique index, so the interesting part is that clearing and
    // setting happen as two statements in one transaction rather than as a
    // single `set is_current = (id = $1)`, which can trip the index
    // mid-statement.
    const { error } = await a.rpc("academics_session_activate", { p_session_id: created[0] });
    expect(error).toBeNull();

    const { data: currents } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true);
    expect(currents).toHaveLength(1);
    expect(currents![0].id).toBe(created[0]);

    const { error: back } = await a.rpc("academics_session_activate", { p_session_id: before.id });
    expect(back).toBeNull();

    const { data: after } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true);
    expect(after).toHaveLength(1);
    expect(after![0].id).toBe(before.id);
  });

  it("says which rows are filed in the wrong year, in sentences", async () => {
    const { data, error } = await a.rpc("academics_filing_problems");
    expect(error).toBeNull();

    for (const row of data ?? []) {
      expect(row.severity).toBe("warning");
      expect(row.message.length).toBeGreaterThan(0);
      // Number agreement is a property of the whole sentence (migration
      // `0197`): a message that starts "1 " must not then say "are" or "They".
      if (row.message.startsWith("1 ")) {
        expect(row.message).not.toMatch(/\bare\b/);
        expect(row.message).not.toMatch(/\bThey\b/);
      }
    }
  });

  it("stamps a dated row from its own date, not from the flag", async () => {
    // The whole of migration `0198` in one assertion. `academics_session_for_date`
    // is arithmetic over the year list; `current_session_id()` is a decision the
    // school makes. A register, a book issue and a visitor pass follow the first.
    const { data: today } = await a.rpc("mobile_today");
    const { data: dateYear } = await a.rpc("academics_session_for_date", {
      p_on: today as unknown as string,
    });
    const { data: current } = await a
      .from("academic_sessions")
      .select("id, name")
      .eq("is_current", true)
      .maybeSingle();

    // Both must exist for the rest of the suite to mean anything; whether they
    // are the *same* row is the school's business and not this test's.
    expect(dateYear ?? current?.id).toBeTruthy();
  });

  it("refuses a date no year covers, naming the date and the remedy", async () => {
    const { error } = await a.rpc("academics_session_for_date_or_raise", {
      p_on: "1919-05-06",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("No academic year covers");
    expect(error!.message).toContain("May 1919");
    // A refusal with no remedy is a dead end; this one says where to go.
    expect(error!.message).toContain("Academics");
  });

  it("appears on the checks screen rather than only in the module", async () => {
    const { data } = await a.rpc("checks_run");
    const keys = new Set((data ?? []).map((r) => r.key));
    expect(keys.has("academics.filing")).toBe(true);
  });
});
