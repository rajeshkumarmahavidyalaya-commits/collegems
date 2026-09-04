import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DRIVERS, type Driver } from "./drivers.ts";

/**
 * Drains `notification_deliveries`.
 *
 * This is the thing rule 10 promised and did not have: one dispatcher, holding
 * every provider credential, so that no module in the Next.js app has ever
 * heard of Resend or Twilio. Adding WhatsApp is a driver here.
 *
 * TWO CALLERS, AND THEY GET DIFFERENT SCOPES
 *
 *   the service role  -> every tenant. This is the scheduled run.
 *   an administrator  -> their own tenant, and only theirs. This is the
 *                        "send the queued ones now" button.
 *
 * Deployed WITH JWT verification, so the gateway has already proved the token
 * was signed by this project before a line of this runs; the claims below are
 * therefore trustworthy to read. The tenant is taken from the token's
 * `app_metadata`, never from the request body -- a body-supplied tenant id is
 * how one school ends up spending another school's SMS credit.
 *
 * BOUNDED, per rule 7. At most 200 deliveries or 40 seconds per invocation,
 * whichever comes first, and the reply says how many are still waiting. That is
 * the difference between "queued work" and "unbounded work in a request
 * handler": this one says its bound out loud and can be called again.
 *
 * ORDER MATTERS: report, then claim. `notify_claim_deliveries` will not hand
 * out work for a channel whose `provider_configured` is false, and this
 * function is the only thing that can set it -- so every run reports what each
 * driver can do before asking for anything to send.
 */

const MAX_PER_RUN = 200;
const BATCH = 25;
const BUDGET_MS = 40_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Claims = { role?: string; app_metadata?: { tenant_id?: string; role?: string } };

/** The gateway has verified the signature; this only reads what it said. */
function readClaims(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))) as Claims;
  } catch {
    return null;
  }
}

type Settings = {
  tenant_id: string;
  channel: string;
  is_enabled: boolean;
  from_address: string | null;
  sender_name: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);

  const claims = readClaims(authorization.slice(7).trim());
  if (!claims) return json({ error: "Not signed in" }, 401);

  const isScheduledRun = claims.role === "service_role";
  const tenantId = isScheduledRun ? null : claims.app_metadata?.tenant_id;

  if (!isScheduledRun) {
    // A signed-in person is not enough. Draining the queue sends messages in
    // the school's name, which is an administrator's act.
    if (claims.app_metadata?.role !== "admin") {
      return json({ error: "Only an administrator can send the queued messages" }, 403);
    }
    if (!tenantId) return json({ error: "This login has no school" }, 403);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ---- report what each driver can do, for every tenant in scope -----------

  // The service role bypasses RLS, so the tenant filter is written by hand.
  // That is rule 7's standing warning about Edge Functions, and the one place
  // in this file where forgetting it would be a cross-tenant leak.
  let settingsQuery = admin
    .from("notification_channel_settings")
    .select("tenant_id, channel, is_enabled, from_address, sender_name")
    .neq("channel", "in_app");
  if (tenantId) settingsQuery = settingsQuery.eq("tenant_id", tenantId);

  const { data: settings, error: settingsError } = await settingsQuery;
  if (settingsError) return json({ error: settingsError.message }, 500);

  const driverFor = new Map<string, Driver>(DRIVERS.map((d) => [d.channel, d]));
  const configured = new Map<string, boolean>();

  for (const row of (settings ?? []) as Settings[]) {
    const driver = driverFor.get(row.channel);
    if (!driver) continue;

    const check = driver.configure(row.from_address);
    configured.set(`${row.tenant_id}:${row.channel}`, check.ok);

    const { error } = await admin.rpc("notify_channel_report", {
      p_tenant_id: row.tenant_id,
      p_channel: row.channel,
      p_provider: driver.provider,
      p_configured: check.ok,
      p_error: check.ok ? null : check.reason,
    });
    if (error) return json({ error: error.message }, 500);
  }

  const settingsFor = new Map(
    ((settings ?? []) as Settings[]).map((s) => [`${s.tenant_id}:${s.channel}`, s]),
  );

  // ---- then drain ---------------------------------------------------------

  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;
  let handled = 0;

  while (handled < MAX_PER_RUN && Date.now() - startedAt < BUDGET_MS) {
    const { data: claimed, error: claimError } = await admin.rpc("notify_claim_deliveries", {
      p_limit: Math.min(BATCH, MAX_PER_RUN - handled),
      p_tenant_id: tenantId,
      p_channel: null,
    });
    if (claimError) return json({ error: claimError.message }, 500);
    if (!claimed || claimed.length === 0) break;

    for (const delivery of claimed) {
      handled += 1;
      const driver = driverFor.get(delivery.channel);
      const key = `${delivery.tenant_id}:${delivery.channel}`;
      const channelSettings = settingsFor.get(key);

      // A claimed delivery with no address is a dead letter, not a retry: the
      // recipient had no email or phone number recorded when the message was
      // composed, and trying again in four minutes will not give them one.
      let result: { ok: boolean; ref?: string | null; error?: string };
      if (!delivery.address) {
        result = { ok: false, error: "No address was recorded for this recipient." };
      } else if (!driver || !configured.get(key)) {
        result = { ok: false, error: "This channel cannot send from this deployment." };
      } else {
        try {
          const outcome = await driver.send({
            address: delivery.address,
            subject: delivery.subject,
            body: delivery.body,
            fromAddress: channelSettings?.from_address ?? null,
            senderName: channelSettings?.sender_name ?? null,
          });
          result = outcome.ok
            ? { ok: true, ref: outcome.ref }
            : { ok: false, error: outcome.error };
        } catch (thrown) {
          // A provider that times out must not take the whole batch with it.
          result = { ok: false, error: String(thrown).slice(0, 400) };
        }
      }

      if (result.ok) sent += 1;
      else failed += 1;

      const { error } = await admin.rpc("notify_record_result", {
        p_delivery_id: delivery.id,
        p_ok: result.ok,
        p_error: result.error ?? null,
        p_provider_ref: result.ref ?? null,
      });
      if (error) return json({ error: error.message }, 500);
    }
  }

  // How many are still waiting, so the caller knows whether to call again
  // rather than guessing from a count of what was done.
  let remainingQuery = admin
    .from("notification_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .neq("channel", "in_app");
  if (tenantId) remainingQuery = remainingQuery.eq("tenant_id", tenantId);
  const { count: remaining } = await remainingQuery;

  return json({
    scope: isScheduledRun ? "all tenants" : tenantId,
    sent,
    failed,
    handled,
    remaining: remaining ?? 0,
    truncated: handled >= MAX_PER_RUN,
  });
});
