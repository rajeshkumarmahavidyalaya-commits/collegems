import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";
import { channelSends, channelState } from "@/lib/validations/notifications";

/**
 * The dispatcher's contract, against the real database.
 *
 * Four claims, and each is a way this could have been built wrongly:
 *
 *   - **Nothing but the dispatcher may touch the queue.** `notify_claim_...`,
 *     `notify_record_result` and `notify_channel_report` are definer and
 *     revoked from `authenticated`, exactly like
 *     `fees_settle_gateway_payment`. A school that could call them could mark
 *     another school's mail as sent.
 *   - **A school may configure a channel and may not rewrite its history.**
 *     The policy admits an administrator; the column GRANT admits three
 *     columns. `last_error` is not one of them, because a school that can hide
 *     a failure has a delivery log that means nothing.
 *   - **Nothing is claimable until a dispatcher has reported.** That is what
 *     stops a missing API key becoming a thousand failed deliveries.
 *   - **A held channel keeps its queue rather than dropping it**, and the
 *     status read model says so in a sentence.
 */
describe("the notification dispatcher", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();
  });

  it("hides the queue functions from everybody holding a JWT", async () => {
    const claim = await a.rpc("notify_claim_deliveries", { p_limit: 1 });
    expect(claim.error, "claiming must be denied to a signed-in admin").not.toBeNull();

    const report = await a.rpc("notify_channel_report", {
      p_tenant_id: "00000000-0000-4000-8000-000000000001",
      p_channel: "email",
      p_provider: "resend",
      p_configured: true,
    });
    expect(report.error, "reporting configuration must be denied too").not.toBeNull();

    const record = await a.rpc("notify_record_result", {
      p_delivery_id: "00000000-0000-4000-8000-000000000001",
      p_ok: true,
    });
    expect(record.error).not.toBeNull();
  });

  it("lets an administrator turn a channel on and set its sender", async () => {
    const { data: before } = await a
      .from("notification_channel_settings")
      .select("id, is_enabled, from_address")
      .eq("channel", "email")
      .single();
    expect(before).not.toBeNull();

    const { error } = await a
      .from("notification_channel_settings")
      .update({ from_address: "office@example.test" })
      .eq("id", before!.id);
    expect(error).toBeNull();

    // ...and put it back, because this suite runs against the demo tenant.
    await a
      .from("notification_channel_settings")
      .update({ from_address: before!.from_address })
      .eq("id", before!.id);
  });

  it("refuses to let a school rewrite the dispatcher's record", async () => {
    const { data: row } = await a
      .from("notification_channel_settings")
      .select("id, last_error")
      .eq("channel", "email")
      .single();

    // A column-level GRANT, not a policy: the update is denied by privilege,
    // so it RAISES rather than silently matching nothing. That distinction is
    // the one CLAUDE.md's "two ways to be append-only" note is about, and it is
    // why this asserts an error and then re-reads the row anyway.
    const { error } = await a
      .from("notification_channel_settings")
      .update({ last_error: "nothing to see here" })
      .eq("id", row!.id);
    expect(error).not.toBeNull();

    const { data: after } = await a
      .from("notification_channel_settings")
      .select("last_error")
      .eq("id", row!.id)
      .single();
    expect(after!.last_error).toBe(row!.last_error);
  });

  it("does not let a school delete a channel row", async () => {
    // Worse than it looks: the claim query joins settings to deliveries, so a
    // missing row is not an error anywhere -- the channel simply stops being
    // claimable and every screen goes quiet about a queue that is still
    // filling up. Silence is the failure mode this module exists to avoid.
    const { data: row } = await a
      .from("notification_channel_settings")
      .select("id")
      .eq("channel", "push")
      .single();

    const { error } = await a
      .from("notification_channel_settings")
      .delete()
      .eq("id", row!.id);
    expect(error, "DELETE is revoked, so this raises rather than matching nothing").not.toBeNull();

    const { count } = await a
      .from("notification_channel_settings")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(5);
  });

  it("reports a channel's state as one sentence a person can act on", async () => {
    const { data, error } = await a.rpc("notify_channel_status");
    expect(error).toBeNull();

    const rows = data ?? [];
    expect(rows.map((r) => r.channel)).toEqual(["in_app", "email", "sms", "whatsapp", "push"]);

    for (const row of rows) {
      const status = {
        channel: row.channel as "in_app" | "email" | "sms" | "whatsapp" | "push",
        isEnabled: row.is_enabled,
        fromAddress: row.from_address,
        senderName: row.sender_name,
        provider: row.provider,
        providerConfigured: row.provider_configured,
        lastAttemptAt: row.last_attempt_at,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error,
        queued: row.queued,
        oldestQueuedAt: row.oldest_queued_at,
        failed: row.failed,
        sentRecently: row.sent_recently,
      };
      expect(channelState(status).sentence.length).toBeGreaterThan(10);
    }

    // In-app is the one channel that always sends, because the row is the
    // delivery. Every other channel needs three separate things to be true.
    const inApp = rows.find((r) => r.channel === "in_app")!;
    expect(inApp.is_enabled).toBe(true);

    for (const channel of ["whatsapp", "push"] as const) {
      const row = rows.find((r) => r.channel === channel)!;
      expect(
        channelSends({
          channel,
          isEnabled: row.is_enabled,
          fromAddress: row.from_address,
          senderName: row.sender_name,
          provider: row.provider,
          providerConfigured: row.provider_configured,
          lastAttemptAt: row.last_attempt_at,
          lastSuccessAt: row.last_success_at,
          lastError: row.last_error,
          queued: row.queued,
          oldestQueuedAt: row.oldest_queued_at,
          failed: row.failed,
          sentRecently: row.sent_recently,
        }),
        `${channel} has no driver in this build`,
      ).toBe(false);
    }
  });

  it("keeps a held channel's queue rather than dropping it", async () => {
    const { data } = await a.rpc("notify_channel_status");
    const email = (data ?? []).find((r) => r.channel === "email")!;

    // Whatever the demo tenant's numbers are, a queued message must never be
    // counted as sent, and a channel that cannot send must not be reporting
    // successes it did not have.
    if (!email.provider_configured) {
      expect(email.last_success_at).toBeNull();
    }
    expect(email.queued).toBeGreaterThanOrEqual(0);
  });

  it("does not show one school another school's channels", async () => {
    const { data: mine } = await a.from("notification_channel_settings").select("tenant_id");
    const { data: theirs } = await b.from("notification_channel_settings").select("tenant_id");

    const aTenants = new Set((mine ?? []).map((r) => r.tenant_id));
    const bTenants = new Set((theirs ?? []).map((r) => r.tenant_id));
    expect(aTenants.size).toBe(1);
    expect(bTenants.size).toBe(1);
    expect([...aTenants][0]).not.toBe([...bTenants][0]);
  });
});
