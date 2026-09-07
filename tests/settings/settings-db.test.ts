import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The settings catalogue, through real RLS.
 *
 * What is worth proving from the app's side:
 *
 *   1. **A key nobody declared is refused.** That is what makes this a
 *      catalogue rather than the free-form bag it replaced — and it is what
 *      stops somebody adding `razorpay.key_secret` to a table every tenant
 *      member can read.
 *   2. **The declared shape is enforced**, in a sentence naming the setting.
 *   3. **One place for a default.** `setting_value` on a key a tenant has
 *      never set returns the catalogue's default rather than null.
 *   4. **Tenant isolation**, in both directions.
 */
describe("settings", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  it("refuses a key that is not in the catalogue", async () => {
    const result = await a.rpc("setting_set", {
      p_key: "razorpay.key_secret",
      p_value: "sk_live_not_a_real_key" as never,
    });

    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain("no setting called");
  });

  it("refuses a value of the wrong shape, and names the setting", async () => {
    const result = await a.rpc("setting_set", {
      p_key: "library.fine_per_day",
      p_value: "five rupees" as never,
    });

    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain("Library fine per day");
  });

  it("has no secret in the catalogue, now or ever", async () => {
    // The catalogue is readable by everybody, so this is also a check that
    // nothing sensitive has been catalogued by a later migration.
    const { data } = await a.rpc("settings_effective");
    for (const row of data ?? []) {
      expect(row.value_type).not.toBe("secret");
      expect(row.key).not.toMatch(/secret|password|token|api_key/i);
    }
  });

  it("applies the catalogue default in exactly one place", async () => {
    const { data, error } = await a.rpc("setting_value", { p_key: "library.fine_per_day" });
    expect(error).toBeNull();
    // Either the tenant's own value or the catalogue's — never null, which is
    // what every caller used to guard against with its own literal.
    expect(data).not.toBeNull();
    expect((data as { amount?: number }).amount).toBeTypeOf("number");
  });

  it("returns null for a key with no catalogue row, rather than inventing one", async () => {
    const { data } = await a.rpc("setting_value", { p_key: "not.a.real.setting" });
    expect(data).toBeNull();
  });

  it("keeps one tenant's settings out of the other's", async () => {
    const [mine, theirs] = await Promise.all([
      a.from("settings").select("id, tenant_id"),
      b.from("settings").select("id, tenant_id"),
    ]);

    const otherIds = new Set((theirs.data ?? []).map((r) => r.id));
    for (const row of mine.data ?? []) {
      expect(otherIds.has(row.id), "a setting leaked across tenants").toBe(false);
    }
  });

  it("describes every stored key, so nothing is orphaned", async () => {
    // `settings_problems()` reports a stored key with no catalogue row as
    // `info`. An empty result here means the catalogue and the table agree.
    const { data, error } = await a.rpc("settings_problems");
    expect(error).toBeNull();
    const orphans = (data ?? []).filter((p) => p.severity === "info");
    expect(orphans.map((p) => p.message)).toEqual([]);
  });
});
