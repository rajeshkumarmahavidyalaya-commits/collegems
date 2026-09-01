import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Razorpay webhook -> the fees ledger.
 *
 * Deployed with JWT verification OFF, because Razorpay cannot present one.
 * This function therefore does its own authentication, and that signature
 * check is the only thing standing between the open internet and a function
 * that books money. Everything here is arranged around not weakening it:
 *
 *  - The raw body is read ONCE, as text, and verified before it is parsed.
 *    Parsing and re-serialising would change the bytes and break the HMAC --
 *    and "the signature kept failing so I compared the parsed object instead"
 *    is how this check gets quietly removed.
 *  - A missing secret is a hard failure, never a skipped check.
 *  - The comparison is constant-time.
 *
 * What the callback is trusted for is deliberately small: the order id, the
 * event id, and an amount that must AGREE with the intent this system already
 * wrote. `fees_settle_gateway_payment` takes the actual figure from that
 * intent, so a forged body cannot decide how much was paid even if it somehow
 * arrived signed.
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) {
    // Fail closed. An unconfigured deployment must reject callbacks, not
    // accept unsigned ones.
    console.error("RAZORPAY_WEBHOOK_SECRET is not set; refusing every callback");
    return json({ error: "Webhook is not configured" }, 503);
  }

  const raw = await req.text();
  const provided = req.headers.get("x-razorpay-signature");
  if (!provided) return json({ error: "Missing signature" }, 401);

  const expected = await hmacSha256Hex(secret, raw);
  if (!timingSafeEqual(provided, expected)) {
    console.warn("Rejected a callback whose signature did not verify");
    return json({ error: "Bad signature" }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Body is not JSON" }, 400);
  }

  const kind = String(event.event ?? "");
  const payload = (event.payload ?? {}) as Record<string, any>;

  // Only the events that mean "money has actually been captured". Anything
  // else is acknowledged with 200 so Razorpay stops retrying it, but nothing
  // is written.
  const settles = kind === "payment_link.paid" || kind === "order.paid" || kind === "payment.captured";
  if (!settles) return json({ ignored: kind });

  const orderId: string | undefined =
    payload.payment_link?.entity?.id ??
    payload.order?.entity?.id ??
    payload.payment?.entity?.order_id;

  const paisa: number | undefined = payload.payment?.entity?.amount ?? payload.order?.entity?.amount;
  const paymentId: string | undefined = payload.payment?.entity?.id;
  const method: string | undefined = payload.payment?.entity?.method;

  // Razorpay's own event id is the canonical idempotency key; the payment id
  // is a stable fallback when the header is absent.
  const eventId = req.headers.get("x-razorpay-event-id") ?? paymentId;

  if (!orderId || paisa === undefined || !eventId) {
    console.error("Signed callback was missing order id, amount or event id", { kind });
    return json({ error: "Callback is missing fields this system needs" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin.rpc("fees_settle_gateway_payment", {
    p_provider: "razorpay",
    p_provider_order_id: orderId,
    p_provider_event_id: eventId,
    // Razorpay works in paise; the ledger works in rupees.
    p_amount: paisa / 100,
    p_method: method === "upi" || method === "card" || method === "netbanking" ? method : "online",
    p_reference: paymentId ?? null,
  });

  if (error) {
    // 500 so Razorpay retries: settling is idempotent on the event id, so a
    // retry after a transient failure converges rather than double-booking.
    console.error("Could not settle gateway payment", error);
    return json({ error: error.message }, 500);
  }

  return json({ settled: true, receipt: (data as { receipt_number?: string })?.receipt_number });
});
