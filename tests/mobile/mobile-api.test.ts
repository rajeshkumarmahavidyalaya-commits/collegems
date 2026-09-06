import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";
import { mobileBootstrapSchema, mobileHomeSchema } from "@/lib/validations/mobile";

/**
 * The mobile API against the real database.
 *
 * What is being proven, and why each one could have gone wrong:
 *
 *   - **The documents parse.** A contract nobody runs is a contract that
 *     drifts, and the first person to notice would be a parent whose app went
 *     blank.
 *   - **"My children" is a relationship, not a visibility.** RLS lets an
 *     administrator read every student; `mobile_my_students` must still return
 *     an empty list for them, because a home screen is not a roster.
 *   - **The gate on the detail screen is the same one the report card uses.**
 *     A second answer to "may this person see this child" eventually becomes a
 *     different answer.
 *   - **A device token is a capability.** Nobody but its owner may read one,
 *     administrator included, and `mobile_device_summary` gives counts instead.
 *   - **Tenant isolation still holds** on `devices`.
 */
describe("the mobile API", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();
  });

  it("returns a bootstrap document that matches the published contract", async () => {
    const { data, error } = await a.rpc("mobile_bootstrap");
    expect(error).toBeNull();

    const parsed = mobileBootstrapSchema.safeParse(data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.api_version).toBe(1);
    expect(parsed.data.min_supported_version).toBeLessThanOrEqual(parsed.data.api_version);
    expect(parsed.data.school.timezone.length).toBeGreaterThan(0);
    expect(parsed.data.permissions.length).toBeGreaterThan(0);
    // Every channel the school could send on is described, so a phone's
    // preferences screen tells the same truth the web one does.
    expect(parsed.data.channels.map((c) => c.channel).sort()).toEqual([
      "email",
      "in_app",
      "push",
      "sms",
      "whatsapp",
    ]);
  });

  it("returns a home document that matches the published contract", async () => {
    const { data, error } = await a.rpc("mobile_home");
    expect(error).toBeNull();

    const parsed = mobileHomeSchema.safeParse(data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });

  it("gives an administrator no children, because a roster is not a home screen", async () => {
    // The test logins are administrators. RLS lets them read every student in
    // the school; `mobile_my_students` asks a different question.
    const { data, error } = await a.rpc("mobile_my_students");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("computes today in the school's timezone, not the server's", async () => {
    const { data: today, error } = await a.rpc("mobile_today");
    expect(error).toBeNull();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const { data: bootstrap } = await a.rpc("mobile_bootstrap");
    expect((bootstrap as { today: string }).today).toBe(today);
  });

  it("refuses a child in another school", async () => {
    const { data: theirs } = await b.rpc("mobile_my_students");
    void theirs;

    const { data: someone } = await b.from("students").select("id").limit(1).maybeSingle();
    if (!someone) return;

    const { data } = await a.rpc("mobile_student", { p_student_id: someone.id });
    expect(data).toBeNull();
  });

  it("lets a person register and revoke their own device, idempotently", async () => {
    const token = `test-token-${crypto.randomUUID()}`;

    const first = await a.rpc("mobile_register_device", {
      p_push_token: token,
      p_platform: "android",
      p_app_version: "1.0.0",
    });
    expect(first.error).toBeNull();

    // A push token is rotated by the operating system without telling anybody,
    // so registering is "this is my token now" and must converge on a retry.
    const again = await a.rpc("mobile_register_device", {
      p_push_token: token,
      p_platform: "android",
      p_app_version: "1.0.1",
    });
    expect(again.error).toBeNull();
    expect(again.data).toBe(first.data);

    const { count } = await a
      .from("devices")
      .select("id", { count: "exact", head: true })
      .eq("push_token", token);
    expect(count).toBe(1);

    const revoked = await a.rpc("mobile_revoke_device", {
      p_push_token: token,
      p_reason: "test",
    });
    expect(revoked.data).toBe(1);

    // Revoking twice is a no-op, not an error: the caller is usually a retry.
    const twice = await a.rpc("mobile_revoke_device", { p_push_token: token, p_reason: "test" });
    expect(twice.data).toBe(0);

    await a.from("devices").delete().eq("push_token", token);
  });

  it("summarises devices without ever handing over a token", async () => {
    const { data, error } = await a.rpc("mobile_device_summary");
    expect(error).toBeNull();

    for (const row of data ?? []) {
      expect(Object.keys(row).sort()).toEqual(["last_seen_at", "live", "platform", "revoked"]);
    }
  });

  it("does not show one school another school's devices", async () => {
    const token = `isolation-${crypto.randomUUID()}`;
    await a.rpc("mobile_register_device", { p_push_token: token, p_platform: "ios" });

    const { data: theirs } = await b.from("devices").select("id").eq("push_token", token);
    expect(theirs ?? []).toHaveLength(0);

    await a.from("devices").delete().eq("push_token", token);
  });
});
