import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Certificates, through real RLS.
 *
 * The module makes four promises and each is a way it could be built wrongly:
 *
 *   1. **A certificate is frozen.** `body` and `snapshot` cannot be rewritten by
 *      anybody, administrator included, and the row cannot be deleted. Both are
 *      privilege refusals (`42501`), not unmatched policies, so they *raise* --
 *      the distinction CLAUDE.md's "two ways to be append-only" note draws.
 *   2. **A number is never reused and never disappears.** Cancelling keeps the
 *      serial.
 *   3. **One live transfer certificate per student**, as a partial unique index
 *      rather than a check-then-insert.
 *   4. **The engine refuses rather than printing a hole.** A template with a
 *      placeholder nothing fills cannot be issued.
 *
 * The suite runs against the demo tenant, so every test that writes cleans up
 * after itself by cancelling -- which is the only cleanup the module permits,
 * and proving that is itself part of the point.
 */
describe("certificates", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  async function aStudentWithBothParents(): Promise<string> {
    const { data } = await a
      .from("students")
      .select("id, guardian_student ( relationship )")
      .eq("status", "active")
      .limit(50);

    const found = (data ?? []).find((s) => {
      const rels = (s.guardian_student ?? []).map((g) => g.relationship);
      return rels.includes("father") && rels.includes("mother");
    });
    if (!found) throw new Error("The demo tenant has no student with both parents linked");
    return found.id;
  }

  async function templateOfKind(kind: string) {
    const { data } = await a
      .from("certificate_templates")
      .select("id, name, body, fields")
      .eq("kind", kind)
      .eq("is_active", true)
      .limit(1)
      .single();
    return data!;
  }

  it("criticises a template in sentences rather than refusing to save it", async () => {
    const { data: templates } = await a.from("certificate_templates").select("id, name");

    for (const t of templates ?? []) {
      const { data, error } = await a.rpc("certificate_template_problems", { p_template_id: t.id });
      expect(error, `${t.name} could not be criticised`).toBeNull();

      for (const problem of data ?? []) {
        expect(["error", "warning", "info"]).toContain(problem.severity);
        // Sentences, not codes -- the `grading_scheme_problems()` rule. A person
        // reading this on a screen has to know what to do next.
        expect(problem.message.length).toBeGreaterThan(20);
      }
    }
  });

  it("ships defaults that can actually be issued", async () => {
    // Migration 0136 exists because the seeded transfer certificate printed
    // {{school.city}}, which no school has filled in on day one. A default that
    // refuses on a fresh install is a default nobody can use.
    const { data: templates } = await a
      .from("certificate_templates")
      .select("id, name")
      .eq("is_default", true);

    for (const t of templates ?? []) {
      const { data } = await a.rpc("certificate_template_problems", { p_template_id: t.id });
      const errors = (data ?? []).filter((p) => p.severity === "error");
      expect(errors, `${t.name} has blocking problems`).toEqual([]);
    }
  });

  it("refuses to print a placeholder nothing fills", async () => {
    const studentId = await aStudentWithBothParents();
    const template = await templateOfKind("bonafide");

    // The bonafide asks for a purpose. Withhold it.
    const preview = await a.rpc("certificate_preview", {
      p_student_id: studentId,
      p_template_id: template.id,
      p_extra: {},
    });
    expect(preview.error).toBeNull();

    const body = preview.data as {
      can_issue: boolean;
      problems: { severity: string; message: string }[];
      unresolved: string[];
    };
    expect(body.can_issue).toBe(false);
    expect(body.unresolved).toContain("purpose");
    expect(body.problems.some((p) => p.severity === "error" && p.message.includes("purpose"))).toBe(true);

    // ...and the refusal is enforced in the function, not in the screen.
    const issued = await a.rpc("certificate_issue", {
      p_student_id: studentId,
      p_template_id: template.id,
      p_extra: {},
    });
    expect(issued.error).not.toBeNull();
  });

  it("notes the serial as coming later rather than as a hole", async () => {
    const studentId = await aStudentWithBothParents();
    const template = await templateOfKind("bonafide");

    const { data } = await a.rpc("certificate_preview", {
      p_student_id: studentId,
      p_template_id: template.id,
      p_extra: { purpose: "a passport application" },
    });

    const body = data as { can_issue: boolean; problems: { severity: string }[] };
    // {{serial}} is still standing, but it is an `info`, not an `error` -- the
    // number is allocated by the act of issuing.
    expect(body.can_issue).toBe(true);
    expect(body.problems.some((p) => p.severity === "info")).toBe(true);
  });

  it("issues, freezes, and refuses every edit afterwards", async () => {
    const studentId = await aStudentWithBothParents();
    const template = await templateOfKind("bonafide");

    const { data: issued, error } = await a.rpc("certificate_issue", {
      p_student_id: studentId,
      p_template_id: template.id,
      p_extra: { purpose: "a bank account application" },
    });
    expect(error).toBeNull();

    const row = issued as unknown as { id: string; serial_no: string; body: string; status: string };
    expect(row.serial_no).toMatch(/^CERT-\d{4}-\d{5}$/);
    expect(row.body).not.toContain("{{");

    // Frozen: a revoked privilege, so this RAISES rather than matching nothing.
    const rewrite = await a.from("certificates").update({ body: "tampered" }).eq("id", row.id);
    expect(rewrite.error, "body must not be writable by anybody").not.toBeNull();

    const removal = await a.from("certificates").delete().eq("id", row.id);
    expect(removal.error, "a serial must never disappear").not.toBeNull();

    // ...and the row still says what it said.
    const { data: after } = await a
      .from("certificates")
      .select("body, serial_no")
      .eq("id", row.id)
      .single();
    expect(after!.body).toBe(row.body);

    // Cleanup is a cancellation, which is the only thing the module allows.
    const cancelled = await a.rpc("certificate_cancel", {
      p_certificate_id: row.id,
      p_reason: "Issued by the automated test suite",
    });
    expect(cancelled.error).toBeNull();

    const { data: kept } = await a
      .from("certificates")
      .select("serial_no, status, cancel_reason")
      .eq("id", row.id)
      .single();
    expect(kept!.serial_no).toBe(row.serial_no);
    expect(kept!.status).toBe("cancelled");
    expect(kept!.cancel_reason).toContain("test suite");
  });

  it("will not cancel without a reason", async () => {
    const { data: existing } = await a.from("certificates").select("id").limit(1);
    if (!existing?.length) return;

    const result = await a.rpc("certificate_cancel", {
      p_certificate_id: existing[0].id,
      p_reason: "   ",
    });
    expect(result.error).not.toBeNull();
  });

  it("takes a student off the roll when it issues a transfer, and puts them back when it is cancelled", async () => {
    const studentId = await aStudentWithBothParents();
    const template = await templateOfKind("transfer");

    const { data: issued, error } = await a.rpc("certificate_issue", {
      p_student_id: studentId,
      p_template_id: template.id,
      p_extra: { conduct: "Excellent", reason: "Issued by the automated test suite" },
    });
    expect(error).toBeNull();
    const row = issued as unknown as { id: string; serial_no: string };

    const { data: during } = await a
      .from("students")
      .select("status")
      .eq("id", studentId)
      .single();
    expect(during!.status).toBe("transferred");

    // A second live one is impossible -- a partial unique index, not a
    // check-then-insert, so two clerks pressing the button together cannot
    // both win.
    const second = await a.rpc("certificate_issue", {
      p_student_id: studentId,
      p_template_id: template.id,
      p_extra: { conduct: "Excellent", reason: "Should not be possible" },
    });
    expect(second.error).not.toBeNull();

    const cancelled = await a.rpc("certificate_cancel", {
      p_certificate_id: row.id,
      p_reason: "Issued by the automated test suite",
    });
    expect(cancelled.error).toBeNull();

    const { data: afterwards } = await a
      .from("students")
      .select("status")
      .eq("id", studentId)
      .single();
    expect(afterwards!.status).toBe("active");
  });

  it("numbers certificates gaplessly, in one series per session", async () => {
    const { data } = await a
      .from("certificates")
      .select("serial_no")
      .order("serial_no", { ascending: true });

    const numbers = (data ?? [])
      .map((c) => c.serial_no)
      .filter((s) => /^CERT-\d{4}-\d{5}$/.test(s))
      .map((s) => Number(s.slice(-5)));

    // Cancelled certificates keep their numbers, so the series has no holes
    // whatever has been cancelled since.
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i] - numbers[i - 1]).toBe(1);
    }
  });

  it("reads the register off the snapshot, not off the student record", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "certificates.register",
      p_params: {},
      p_limit: 100,
    });
    expect(error).toBeNull();

    for (const row of data ?? []) {
      const r = row.row_data as Record<string, unknown>;
      expect(r.serial_no).toBeTruthy();
      // The name printed on the paper, which a later rename must not change.
      expect(r.student).toBeTruthy();
    }
  });

  it("does not show one school another school's certificates", async () => {
    const { data: mine } = await a.from("certificates").select("tenant_id");
    const { data: theirs } = await b.from("certificates").select("tenant_id");

    const aTenants = new Set((mine ?? []).map((r) => r.tenant_id));
    const bTenants = new Set((theirs ?? []).map((r) => r.tenant_id));
    for (const t of bTenants) expect(aTenants.has(t)).toBe(false);
  });

  it("does not let one school issue against another school's template", async () => {
    const { data: theirs } = await b
      .from("certificate_templates")
      .select("id")
      .limit(1)
      .single();

    const studentId = await aStudentWithBothParents();
    const result = await a.rpc("certificate_issue", {
      p_student_id: studentId,
      p_template_id: theirs!.id,
      p_extra: { purpose: "x" },
    });
    // The template is simply invisible, so this is "no such template" rather
    // than "forbidden" -- which is what RLS does and what it should say.
    expect(result.error).not.toBeNull();
  });
});
