import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The notification service, exercised through real RLS.
 *
 * The claims worth proving here are the ones that would be expensive to
 * discover later: that a delivery cannot be forged or edited by the person it
 * was addressed to, that a preference actually suppresses a channel rather than
 * merely being recorded, that the dispatcher's queue functions are unreachable
 * from a browser, and that one school's outbox is invisible to another's.
 */
describe("notification service", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let tenantAId: string;
  let userAId: string;

  const marker = `test-${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: profile } = await a.from("user_profiles").select("id, tenant_id").single();
    userAId = profile!.id;
    tenantAId = profile!.tenant_id;
  });

  it("fans one message out to one delivery per recipient per channel", async () => {
    const { data: notification, error } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Fan-out ${marker}`,
      p_body: `Fan-out check ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app", "email"],
    });

    expect(error).toBeNull();
    expect(notification).not.toBeNull();

    const { data: deliveries } = await a
      .from("notification_deliveries")
      .select("channel, status, sent_at")
      .eq("notification_id", notification!.id);

    expect(deliveries).toHaveLength(2);

    // In-app is `sent` the moment it exists, because the row *is* the delivery.
    const inApp = deliveries!.find((d) => d.channel === "in_app")!;
    expect(inApp.status).toBe("sent");
    expect(inApp.sent_at).not.toBeNull();

    // Email is queued and stays queued: no driver is connected, and the log
    // must not claim otherwise.
    const email = deliveries!.find((d) => d.channel === "email")!;
    expect(["queued", "skipped"]).toContain(email.status);
    expect(email.sent_at).toBeNull();
  });

  it("interpolates the payload into the body", async () => {
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Interpolation ${marker}`,
      p_body: `Sports day has moved to {{date}}. ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: { date: "12 September" },
      p_channels: ["in_app"],
    });

    const { data: delivery } = await a
      .from("notification_deliveries")
      .select("body")
      .eq("notification_id", notification!.id)
      .single();

    expect(delivery!.body).toContain("12 September");
    expect(delivery!.body).not.toContain("{{date}}");
  });

  it("leaves an unsupplied variable visible rather than blanking it", async () => {
    // A silently emptied placeholder produces "Your fee of  is due", which
    // reads as a bug in the amount. Leaving `{{amount}}` in place makes the
    // missing payload key obvious to whoever reads the message.
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Missing variable ${marker}`,
      p_body: `Your fee of {{amount}} is due. ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    const { data: delivery } = await a
      .from("notification_deliveries")
      .select("body")
      .eq("notification_id", notification!.id)
      .single();

    expect(delivery!.body).toContain("{{amount}}");
  });

  it("refuses an event key that is not in the catalog", async () => {
    const { error } = await a.rpc("notify_send", {
      p_event_key: "not.a.real.event",
      p_subject: "",
      p_body: "hello",
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("Unknown notification type");
  });

  it("refuses an audience that matches nobody, instead of silently sending nothing", async () => {
    const { error } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: "",
      p_body: `Nobody ${marker}`,
      p_audience: { kind: "users", user_ids: ["00000000-0000-4000-8000-000000000000"] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("matched nobody");
  });

  it("respects an opt-out for one channel without touching the others", async () => {
    await a.from("notification_preferences").upsert(
      {
        tenant_id: tenantAId,
        user_id: userAId,
        event_key: "general.announcement",
        channel: "sms",
        enabled: false,
      },
      { onConflict: "tenant_id,user_id,event_key,channel" },
    );

    try {
      const { data: notification } = await a.rpc("notify_send", {
        p_event_key: "general.announcement",
        p_subject: `Opt-out ${marker}`,
        p_body: `Opt-out check ${marker}`,
        p_audience: { kind: "users", user_ids: [userAId] },
        p_payload: {},
        p_channels: ["in_app", "sms"],
      });

      const { data: deliveries } = await a
        .from("notification_deliveries")
        .select("channel")
        .eq("notification_id", notification!.id);

      expect(deliveries!.map((d) => d.channel)).toEqual(["in_app"]);
    } finally {
      await a
        .from("notification_preferences")
        .delete()
        .eq("user_id", userAId)
        .eq("event_key", "general.announcement")
        .eq("channel", "sms");
    }
  });

  it("counts and clears unread in-app messages", async () => {
    await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Unread ${marker}`,
      p_body: `Unread check ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    const { data: before } = await a.rpc("notify_unread_count");
    expect(before!).toBeGreaterThan(0);

    const { data: cleared } = await a.rpc("notify_mark_all_read");
    expect(cleared!).toBeGreaterThan(0);

    const { data: after } = await a.rpc("notify_unread_count");
    expect(after).toBe(0);
  });

  it("shows a recipient their own delivery through the inbox", async () => {
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "notice.published",
      p_subject: `Inbox ${marker}`,
      p_body: `Inbox check ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    const { data: inbox, error } = await a.rpc("notify_inbox", {
      p_limit: 50,
      p_only_unread: false,
    });

    expect(error).toBeNull();
    expect(inbox!.some((row) => row.notification_id === notification!.id)).toBe(true);

    // The catalog name comes back joined, so the inbox never has to ship a
    // client-side map of event keys to human wording.
    const row = inbox!.find((r) => r.notification_id === notification!.id)!;
    expect(row.event_name).toBeTruthy();
  });

  it("rolls delivery outcomes up per notification in the outbox", async () => {
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Outbox ${marker}`,
      p_body: `Outbox check ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app", "email"],
    });

    const { data: outbox } = await a.rpc("notify_outbox", { p_limit: 50 });
    const row = outbox!.find((r) => r.id === notification!.id)!;

    expect(row).toBeDefined();
    expect(row.recipients).toBe(1);
    expect(row.deliveries).toBe(2);
    expect(row.sent + row.queued + row.failed + row.skipped).toBe(2);
  });

  it("filters the outbox by event key", async () => {
    const { data: filtered } = await a.rpc("notify_outbox", {
      p_limit: 50,
      p_event_key: "notice.published",
    });

    for (const row of filtered ?? []) {
      expect(row.event_key).toBe("notice.published");
    }
  });

  // -------------------------------------------------------------------------
  // The boundaries
  // -------------------------------------------------------------------------

  it("does not let a recipient forge a delivery to themselves", async () => {
    // There is no INSERT policy on notification_deliveries at all. Only
    // notify_send, which is SECURITY DEFINER with an explicit admin guard,
    // writes here -- which is what stops a student inventing a message from the
    // principal.
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Forge ${marker}`,
      p_body: `Forge check ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    const { error } = await a.from("notification_deliveries").insert({
      tenant_id: tenantAId,
      notification_id: notification!.id,
      recipient_user_id: userAId,
      channel: "in_app",
      body: "Fees waived for this student.",
      status: "sent",
    });

    expect(error).not.toBeNull();
  });

  it("does not let a recipient rewrite the message they were sent", async () => {
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Rewrite ${marker}`,
      p_body: `Original wording ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    const { data: delivery } = await a
      .from("notification_deliveries")
      .select("id")
      .eq("notification_id", notification!.id)
      .single();

    // The update policy's WITH CHECK permits the row, but only `read_at` is
    // worth changing -- a rewritten body would make the delivery log a record
    // of what the recipient wished they had been told.
    await a
      .from("notification_deliveries")
      .update({ body: "Fees waived." })
      .eq("id", delivery!.id);

    const { data: after } = await a
      .from("notification_deliveries")
      .select("body")
      .eq("id", delivery!.id)
      .single();

    expect(after!.body).toContain("Original wording");
  });

  it("keeps the dispatcher's queue functions out of reach of a browser", async () => {
    // These two run as the service role inside an Edge Function. Execute is
    // revoked from `authenticated` outright, so a JWT cannot claim a delivery
    // or mark one sent however it asks.
    const claim = await a.rpc(
      "notify_claim_deliveries" as never,
      { p_limit: 10 } as never,
    );
    expect(claim.error).not.toBeNull();

    const record = await a.rpc(
      "notify_record_result" as never,
      {
        p_delivery_id: "00000000-0000-4000-8000-000000000000",
        p_ok: true,
      } as never,
    );
    expect(record.error).not.toBeNull();
  });

  it("keeps one school's outbox invisible to another", async () => {
    const { data: notification } = await a.rpc("notify_send", {
      p_event_key: "general.announcement",
      p_subject: `Isolation ${marker}`,
      p_body: `Isolation check ${marker}`,
      p_audience: { kind: "users", user_ids: [userAId] },
      p_payload: {},
      p_channels: ["in_app"],
    });

    const { data: leakedNotification } = await b
      .from("notifications")
      .select("id")
      .eq("id", notification!.id);
    expect(leakedNotification).toEqual([]);

    const { data: leakedDeliveries } = await b
      .from("notification_deliveries")
      .select("id")
      .eq("notification_id", notification!.id);
    expect(leakedDeliveries).toEqual([]);

    const { data: outboxB } = await b.rpc("notify_outbox", { p_limit: 200 });
    expect((outboxB ?? []).some((row) => row.id === notification!.id)).toBe(false);
  });

  it("refuses a second template for the same event and channel", async () => {
    const payload = {
      tenant_id: tenantAId,
      event_key: "fees.due_reminder",
      channel: "sms",
      body: `Reminder ${marker}: {{amount}} is due.`,
      is_active: true,
    };

    const { data: created, error: firstError } = await a
      .from("notification_templates")
      .insert(payload)
      .select("id")
      .single();

    expect(firstError).toBeNull();

    try {
      const { error: secondError } = await a.from("notification_templates").insert(payload);
      expect(secondError).not.toBeNull();
      expect(secondError!.code).toBe("23505");
    } finally {
      await a.from("notification_templates").delete().eq("id", created!.id);
    }
  });

  it("renders a template in place of the caller's wording", async () => {
    const { data: template } = await a
      .from("notification_templates")
      .insert({
        tenant_id: tenantAId,
        event_key: "fees.due_reminder",
        channel: "in_app",
        subject: "Fees due",
        body: `Template ${marker}: {{amount}} is due by {{due_date}}.`,
        is_active: true,
      })
      .select("id")
      .single();

    try {
      const { data: notification } = await a.rpc("notify_send", {
        p_event_key: "fees.due_reminder",
        p_subject: "Ignored subject",
        p_body: "Ignored body",
        p_audience: { kind: "users", user_ids: [userAId] },
        p_payload: { amount: "₹4,500", due_date: "20 September" },
        p_channels: ["in_app"],
      });

      const { data: delivery } = await a
        .from("notification_deliveries")
        .select("subject, body")
        .eq("notification_id", notification!.id)
        .single();

      expect(delivery!.subject).toBe("Fees due");
      expect(delivery!.body).toContain("₹4,500");
      expect(delivery!.body).toContain("20 September");
      expect(delivery!.body).not.toContain("Ignored body");
    } finally {
      await a.from("notification_templates").delete().eq("id", template!.id);
    }
  });
});
