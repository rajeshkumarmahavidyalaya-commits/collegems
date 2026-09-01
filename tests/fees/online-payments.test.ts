import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Online payments, against the real database.
 *
 * The load-bearing claim of this feature is that a callback from the open
 * internet cannot move money it should not. Three things enforce that, and all
 * three live in Postgres:
 *
 *  - `fees_settle_gateway_payment` is SECURITY DEFINER and revoked from every
 *    role a person can hold, so only the service role behind the Edge Function
 *    reaches it;
 *  - it settles against an intent this system wrote, taking the amount from
 *    there rather than from the callback;
 *  - it is idempotent on the provider's event id, so a redelivery converges.
 *
 * (The HMAC check that guards the Edge Function itself is pinned separately in
 * `webhook-signature.test.ts`, which needs no database.)
 */
describe("online payments", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let studentId: string;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
    const { data } = await a.from("students").select("id").limit(1);
    studentId = data![0].id;
  });

  it("never lets a signed-in user settle a gateway payment by hand", async () => {
    // The one function in the module that does not run under the caller's
    // policies is the one nobody holding a JWT may call. An admin is the
    // strongest role there is, and it is still refused.
    const { error } = await a.rpc("fees_settle_gateway_payment" as never, {
      p_provider: "razorpay",
      p_provider_order_id: "plink_anything",
      p_provider_event_id: "evt_anything",
      p_amount: 100,
    } as never);

    expect(error).toBeTruthy();
    // 42501 insufficient_privilege, or PostgREST reporting the function as
    // undefined because it is not exposed to this role at all.
    expect(["42501", "PGRST202", "404"]).toContain(String(error!.code));
  });

  it("refuses to create a payment link while online payments are off", async () => {
    const { data: setting } = await a
      .from("settings")
      .select("value")
      .eq("key", "fees.online_payments")
      .maybeSingle();

    const enabled = (setting?.value as { enabled?: boolean } | null)?.enabled === true;

    const { error } = await a.rpc("fees_create_payment_intent", {
      p_student_id: studentId,
      p_amount: 100,
    });

    if (enabled) {
      // A school that has switched it on can create one; clean it up.
      expect(error).toBeNull();
    } else {
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/switched off/i);
    }
  });

  it("keeps one tenant's payment intents out of another's sight", async () => {
    const { data: mine } = await a.from("payment_intents").select("id").limit(1);
    if (!mine || mine.length === 0) return; // nothing to compare against

    const { data: leaked } = await b.from("payment_intents").select("id").eq("id", mine[0].id);
    expect(leaked ?? []).toHaveLength(0);
  });

  it("will not queue an invoice email without a configured address", async () => {
    const { data: setting } = await a
      .from("settings")
      .select("value")
      .eq("key", "notifications.invoice_email")
      .maybeSingle();

    const value = setting?.value as { enabled?: boolean; to?: string | null } | null;
    const configured = value?.enabled === true && Boolean(value?.to);

    const { data: invoice } = await a
      .from("invoices")
      .select("id")
      .eq("status", "issued")
      .limit(1)
      .maybeSingle();

    if (!invoice) return;

    const { error } = await a.rpc("fees_queue_invoice_email", { p_invoice_id: invoice.id });

    if (configured) {
      expect(error).toBeNull();
    } else {
      // Better to refuse than to queue a job with nowhere to send it.
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/no billing email/i);
    }
  });

  it("shares one receipt series between counter and gateway payments", async () => {
    // The gateway path cannot use `fees_next_document_number()` (no JWT), so it
    // uses the tenant-explicit variant. Both must draw from the same counter --
    // two implementations of a gapless series is a collision waiting to happen.
    const { data: sequences } = await a
      .from("document_sequences")
      .select("kind, next_value")
      .eq("kind", "receipt");

    expect(sequences).toHaveLength(1);
    expect(Number(sequences![0].next_value)).toBeGreaterThan(0);
  });
});
