import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Razorpay subscription events -> `public.subscriptions`.
 *
 * The sibling of `razorpay-webhook`, and separate from it on purpose. That one
 * books a **family's** fee payment into a college's ledger; this one decides
 * whether a college keeps its subscription. Different merchant account,
 * different secret, different blast radius — one function verifying two
 * signatures would make a bug in either half a bug in both.
 *
 * Deployed with JWT verification OFF, because Razorpay cannot present one. So
 * the signature check is the only thing between the open internet and a
 * function that changes what a college is charged, and everything here is
 * arranged around not weakening it:
 *
 *  - the raw body is read ONCE, as text, and verified BEFORE it is parsed —
 *    parsing and re-serialising changes the bytes and breaks the HMAC, and
 *    "the signature kept failing so I compared the parsed object instead" is
 *    how this check gets quietly removed;
 *  - a missing secret is a hard failure, never a skipped check;
 *  - the comparison is constant time.
 *
 * What the callback is trusted for is deliberately small: which subscription,
 * which event, and an event id. **The amount is not taken from the body** —
 * `subscription_settle_provider_event` reads the price from `reference.plans`
 * and refuses a mismatch, so a forged body cannot decide what a college paid
 * even if it somehow arrived signed.
 */

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant time: a length-dependent early return leaks the signature. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Unix seconds -> an ISO date, or null. Razorpay sends periods as epochs. */
function isoDate(epochSeconds: unknown): string | null {
  if (typeof epochSeconds !== "number" || !Number.isFinite(epochSeconds)) return null;
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("PLATFORM_RAZORPAY_WEBHOOK_SECRET");
  if (!secret) {
    // Fail closed. An unconfigured deployment must reject callbacks, never
    // accept unsigned ones.
    console.error("PLATFORM_RAZORPAY_WEBHOOK_SECRET is not set; refusing every callback");
    return json({ error: "Webhook is not configured" }, 503);
  }

  const raw = await req.text();
  const provided = req.headers.get("x-razorpay-signature");
  if (!provided) return json({ error: "Missing signature" }, 401);

  const expected = await hmacSha256Hex(secret, raw);
  if (!timingSafeEqual(provided, expected)) {
    console.warn("Rejected a subscription callback whose signature did not verify");
    return json({ error: "Bad signature" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body is not JSON" }, 400);
  }

  const kind = String(body.event ?? "");
  const payload = (body.payload ?? {}) as Record<string, any>;
  const subscription = payload.subscription?.entity;
  const payment = payload.payment?.entity;

  // Three outcomes this system knows how to apply. Everything else is
  // acknowledged with 200 so Razorpay stops retrying it, and nothing is
  // written — `subscription.authenticated` and `subscription.activated` in
  // particular are NOT money, and treating them as a charge would give a
  // college the plan before the first rupee arrived.
  const EVENTS: Record<string, "charged" | "failed" | "cancelled"> = {
    "subscription.charged": "charged",
    "subscription.halted": "failed",
    "subscription.pending": "failed",
    "subscription.cancelled": "cancelled",
    "subscription.completed": "cancelled",
  };

  const event = EVENTS[kind];
  if (!event) return json({ ignored: kind });

  const subscriptionId: string | undefined = subscription?.id;
  // Razorpay's own event id is the canonical idempotency key; the payment id
  // is a stable fallback when the header is absent, and for the events that
  // carry no payment the subscription id plus the event name still identifies
  // the occurrence.
  const eventId =
    req.headers.get("x-razorpay-event-id") ?? payment?.id ?? `${subscriptionId}:${kind}`;

  if (!subscriptionId || !eventId) {
    console.error("Signed subscription callback was missing its ids", { kind });
    return json({ error: "Callback is missing fields this system needs" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin.rpc("subscription_settle_provider_event", {
    p_provider: "razorpay",
    p_provider_subscription_id: subscriptionId,
    p_provider_event_id: String(eventId),
    p_event: event,
    // Paise, straight through. The database compares this against the plan's
    // own `price_minor` and refuses a mismatch, which is why no conversion
    // happens here — a divide by 100 in the middle is where a rounding
    // argument starts.
    p_amount_minor: typeof payment?.amount === "number" ? payment.amount : null,
    p_provider_payment_id: payment?.id ?? null,
    p_period_start: isoDate(subscription?.current_start),
    p_period_end: isoDate(subscription?.current_end),
  });

  if (error) {
    // 500 so Razorpay retries: settling is idempotent on the event id, so a
    // retry after a transient failure converges rather than charging twice.
    console.error("Could not apply subscription event", kind, error);
    return json({ error: error.message }, 500);
  }

  return json({ applied: event, result: data });
});
