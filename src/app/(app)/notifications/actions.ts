"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  audienceToJson,
  composeSchema,
  preferenceSchema,
  templateSchema,
  toAudience,
} from "@/lib/validations/notifications";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * `notify_send` raises rather than returning an error code for the two failures
 * a composer can actually cause — an audience that matched nobody, and a
 * tenant with no current session — and supabase-js surfaces a raised exception
 * as `P0001` with the message intact. Passing that message straight through is
 * right here precisely because the RPC's messages were written to be read by a
 * person; anything else gets the generic line.
 */
function rpcError(error: { code?: string; message: string }): ActionResult<never> {
  if (error.code === "P0001") return fail(error.message);
  return fail(error.message);
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export type EventType = {
  key: string;
  name: string;
  description: string;
  defaultChannels: string[];
};

export async function listEventTypes(): Promise<EventType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_event_types");
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description,
    defaultChannels: row.default_channels ?? [],
  }));
}

// ---------------------------------------------------------------------------
// My inbox
// ---------------------------------------------------------------------------

export type InboxRow = {
  id: string;
  notificationId: string;
  eventKey: string;
  eventName: string;
  subject: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export async function listInbox(onlyUnread = false, limit = 50): Promise<InboxRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_inbox", {
    p_limit: limit,
    p_only_unread: onlyUnread,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    notificationId: row.notification_id,
    eventKey: row.event_key,
    eventName: row.event_name,
    subject: row.subject,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function getUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_unread_count");
  if (error) return 0; // A bell that cannot count is not a reason to 500 a page.
  return data ?? 0;
}

/**
 * A plain update, not an RPC: `recipients mark own deliveries read` is the
 * policy that allows exactly this and nothing else, so the write is already as
 * narrow as it can be. A row that is not yours simply matches nothing.
 */
export async function markRead(deliveryId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_deliveries")
    .update({ read_at: new Date().toISOString() })
    .eq("id", deliveryId)
    .is("read_at", null);

  if (error) return fail(error.message);

  revalidatePath("/notifications");
  return { ok: true, data: undefined };
}

export async function markAllRead(): Promise<ActionResult<{ count: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_mark_all_read");
  if (error) return fail(error.message);

  revalidatePath("/notifications");
  return { ok: true, data: { count: data ?? 0 } };
}

// ---------------------------------------------------------------------------
// Composing
// ---------------------------------------------------------------------------

export async function sendNotification(
  input: unknown,
): Promise<ActionResult<{ id: string; deliveries: number }>> {
  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const audience = audienceToJson(toAudience(parsed.data));

  const { data, error } = await supabase.rpc("notify_send", {
    p_event_key: parsed.data.eventKey,
    p_subject: parsed.data.subject?.trim() || "",
    p_body: parsed.data.body,
    p_audience: audience,
    p_payload: {},
    p_channels: parsed.data.channels,
  });

  if (error) return rpcError(error);
  if (!data) return fail("The message was not created.");

  // The RPC returns the notification, not the fan-out size, and the count is
  // what the composer wants to see confirmed. One extra read is cheaper than
  // widening the function's return type for a UI detail.
  const { count } = await supabase
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("notification_id", data.id);

  revalidatePath("/notifications");
  revalidatePath("/notifications/log");
  return { ok: true, data: { id: data.id, deliveries: count ?? 0 } };
}

/**
 * How many people the chosen audience actually resolves to, before anything is
 * written. Worth a round-trip: "all parents of 6B" is easy to type and hard to
 * picture, and an administrator who sees `0` here finds out now rather than
 * after `notify_send` refuses, or — worse — after 400 SMS go out.
 *
 * It calls the same `notify_resolve_audience` the send path uses, so the number
 * shown is the number that will be used, not a re-implementation that can drift.
 */
export async function previewAudience(input: unknown): Promise<ActionResult<{ count: number }>> {
  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) return fail("Choose an audience first.");

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_resolve_audience", {
    p_tenant_id: ctx.tenantId,
    p_audience: audienceToJson(toAudience(parsed.data)),
  });

  if (error) return fail(error.message);
  return { ok: true, data: { count: data?.length ?? 0 } };
}

/** Roles a message can be addressed to, in the order the sidebar uses. */
export async function listRoles(): Promise<{ code: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("code, name").order("name");
  return (data ?? []).map((r) => ({ code: r.code, name: r.name }));
}

/**
 * Everyone in this tenant who could receive a message — which means everyone
 * with a login, because a delivery without a `recipient_user_id` has nowhere to
 * go. Students without an account are invisible here on purpose; that is the
 * identity model working, not a gap.
 */
export async function listRecipients(): Promise<
  { id: string; label: string; roleName: string }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, is_active, roles ( name ), people:person_id ( first_name, last_name )")
    .eq("is_active", true);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      label: row.people ? `${row.people.first_name} ${row.people.last_name}` : "Unnamed account",
      roleName: row.roles?.name ?? "",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// The delivery log
// ---------------------------------------------------------------------------

export type OutboxRow = {
  id: string;
  eventKey: string;
  eventName: string;
  subject: string | null;
  body: string;
  audience: Record<string, unknown>;
  createdAt: string;
  createdByName: string | null;
  recipients: number;
  deliveries: number;
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
};

export async function listOutbox(eventKey?: string, limit = 100): Promise<OutboxRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notify_outbox", {
    p_limit: limit,
    p_event_key: eventKey || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    eventKey: row.event_key,
    eventName: row.event_name,
    subject: row.subject,
    body: row.body,
    audience: (row.audience ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    recipients: row.recipients,
    deliveries: row.deliveries,
    sent: row.sent,
    queued: row.queued,
    failed: row.failed,
    skipped: row.skipped,
  }));
}

export type DeliveryRow = {
  id: string;
  recipient: string;
  channel: string;
  address: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  readAt: string | null;
};

/**
 * The drill-down. Two queries rather than an embed: `notification_deliveries`
 * reaches `user_profiles` through `recipient_user_id`, which is an `auth.users`
 * key rather than a declared foreign key to a `public` table, so there is no
 * relationship for PostgREST to traverse.
 */
export async function listDeliveries(notificationId: string): Promise<DeliveryRow[]> {
  const supabase = await createClient();

  const { data: deliveries, error } = await supabase
    .from("notification_deliveries")
    .select("id, recipient_user_id, channel, address, status, attempts, last_error, sent_at, read_at")
    .eq("notification_id", notificationId)
    .order("channel");

  if (error) throw new Error(error.message);
  if (!deliveries?.length) return [];

  const userIds = [...new Set(deliveries.map((d) => d.recipient_user_id).filter(Boolean))];
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, people:person_id ( first_name, last_name )")
    .in("id", userIds as string[]);

  const names = new Map(
    (profiles ?? []).map((p) => [
      p.id,
      p.people ? `${p.people.first_name} ${p.people.last_name}` : "Unnamed account",
    ]),
  );

  return deliveries.map((d) => ({
    id: d.id,
    recipient: (d.recipient_user_id && names.get(d.recipient_user_id)) || "Unknown recipient",
    channel: d.channel,
    address: d.address,
    status: d.status,
    attempts: d.attempts,
    lastError: d.last_error,
    sentAt: d.sent_at,
    readAt: d.read_at,
  }));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type TemplateRow = {
  id: string;
  eventKey: string;
  channel: string;
  subject: string | null;
  body: string;
  isActive: boolean;
};

export async function listTemplates(): Promise<TemplateRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_templates")
    .select("id, event_key, channel, subject, body, is_active")
    .order("event_key");

  if (error) throw new Error(error.message);

  return (data ?? []).map((t) => ({
    id: t.id,
    eventKey: t.event_key,
    channel: t.channel,
    subject: t.subject,
    body: t.body,
    isActive: t.is_active,
  }));
}

export async function saveTemplate(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    event_key: parsed.data.eventKey,
    channel: parsed.data.channel,
    subject: parsed.data.subject?.trim() || null,
    body: parsed.data.body,
    is_active: parsed.data.isActive,
  };

  const { data, error } = id
    ? await supabase.from("notification_templates").update(payload).eq("id", id).select("id").single()
    : await supabase.from("notification_templates").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "This event already has a template for that channel. Edit that one instead.",
        fieldErrors: { channel: ["Already has a template"] },
      };
    }
    return fail(error.message);
  }

  revalidatePath("/notifications/log");
  return { ok: true, data: { id: data.id } };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("notification_templates").delete().eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/notifications/log");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export type PreferenceRow = { eventKey: string; channel: string; enabled: boolean };

export async function listPreferences(): Promise<PreferenceRow[]> {
  const ctx = await getUserContext();
  if (!ctx) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("event_key, channel, enabled")
    .eq("user_id", ctx.userId);

  return (data ?? []).map((p) => ({
    eventKey: p.event_key,
    channel: p.channel,
    enabled: p.enabled,
  }));
}

/**
 * Absence of a row means "use the catalog default", so an opt-back-in deletes
 * rather than writing `enabled = true`. Keeping the row would freeze this
 * person's choice against a later change to the default, which is the opposite
 * of what "I want the normal behaviour" means.
 */
export async function setPreference(input: unknown): Promise<ActionResult> {
  const parsed = preferenceSchema.safeParse(input);
  if (!parsed.success) return fail("That preference is not one this system has.");

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();

  if (parsed.data.enabled) {
    const { error } = await supabase
      .from("notification_preferences")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("event_key", parsed.data.eventKey)
      .eq("channel", parsed.data.channel);
    if (error) return fail(error.message);
  } else {
    const { error } = await supabase.from("notification_preferences").upsert(
      {
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        event_key: parsed.data.eventKey,
        channel: parsed.data.channel,
        enabled: false,
      },
      { onConflict: "tenant_id,user_id,event_key,channel" },
    );
    if (error) return fail(error.message);
  }

  revalidatePath("/notifications/preferences");
  return { ok: true, data: undefined };
}
