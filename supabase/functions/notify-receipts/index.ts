import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  msg91Receipts,
  resendReceipt,
  timingSafeEqual,
  twilioReceipt,
  verifySvix,
  verifyTwilio,
  type Receipt,
} from "./verify.ts";

/**
 * Delivery reports -> `notification_deliveries.receipt_status` (0309).
 *
 * "Sent" has meant "the provider accepted it". This is where each provider
 * says what happened next, so a delivery log can say *delivered*, *not
 * delivered*, *bounced* or *complained* rather than guessing.
 *
 * Deployed with JWT verification OFF, because no provider can present one,
 * so each provider's own proof is the only check there is, and the razorpay
 * webhook's rules apply unchanged:
 *
 *  - the raw body is read once, as text, and verified **before** it is parsed;
 *  - a missing secret is a refusal, never a skipped check;
 *  - comparisons are constant-time.
 *
 * One URL, `?provider=twilio|resend|msg91`:
 *
 *   twilio  X-Twilio-Signature over NOTIFY_RECEIPTS_URL + "?provider=twilio"
 *           and the posted form, keyed with TWILIO_AUTH_TOKEN. The SMS driver
 *           passes exactly that URL as each message's StatusCallback.
 *   resend  Svix headers, keyed with RESEND_WEBHOOK_SECRET.
 *   msg91   `&token=` matching MSG91_RECEIPT_TOKEN: MSG91's delivery-report
 *           webhook carries no signature, so the URL configured in its panel
 *           carries the secret. Weaker than a signature, and the only proof
 *           that gateway offers; said here rather than pretended otherwise.
 *
 * What a report is trusted for is small: a reference and an outcome. The
 * delivery is found by the reference this system stored when it sent
 * (`notify_record_receipt`), so a report naming a message this system never
 * sent changes nothing, and no report can say which college it belongs to.
 */

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function record(receipts: Receipt[]): Promise<number> {
  if (receipts.length === 0) return 0;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  let matched = 0;
  for (const r of receipts) {
    const { data, error } = await admin.rpc("notify_record_receipt", {
      p_channel: r.channel,
      p_ref: r.ref,
      p_state: r.state,
      p_detail: r.detail,
    });
    if (error) throw new Error(error.message);
    matched += Number(data ?? 0);
  }
  return matched;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const raw = await req.text();

  try {
    if (provider === "twilio") {
      const token = Deno.env.get("TWILIO_AUTH_TOKEN");
      const base = Deno.env.get("NOTIFY_RECEIPTS_URL");
      if (!token || !base) return reply({ error: "Receipts are not configured for Twilio" }, 503);
      const params = Object.fromEntries(new URLSearchParams(raw));
      const ok = await verifyTwilio(token, `${base}?provider=twilio`, params, req.headers.get("X-Twilio-Signature"));
      if (!ok) return reply({ error: "Bad signature" }, 401);
      const receipt = twilioReceipt(params);
      return reply({ matched: await record(receipt ? [receipt] : []) });
    }

    if (provider === "resend") {
      const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
      if (!secret) return reply({ error: "Receipts are not configured for Resend" }, 503);
      const ok = await verifySvix(
        secret,
        {
          id: req.headers.get("svix-id"),
          timestamp: req.headers.get("svix-timestamp"),
          signature: req.headers.get("svix-signature"),
        },
        raw,
      );
      if (!ok) return reply({ error: "Bad signature" }, 401);
      const receipt = resendReceipt(JSON.parse(raw));
      return reply({ matched: await record(receipt ? [receipt] : []) });
    }

    if (provider === "msg91") {
      const secret = Deno.env.get("MSG91_RECEIPT_TOKEN");
      if (!secret) return reply({ error: "Receipts are not configured for MSG91" }, 503);
      if (!timingSafeEqual(url.searchParams.get("token") ?? "", secret)) {
        return reply({ error: "Bad token" }, 401);
      }
      // MSG91 posts JSON, or a form whose `data` field is the JSON.
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = JSON.parse(new URLSearchParams(raw).get("data") ?? "[]");
      }
      return reply({ matched: await record(msg91Receipts(payload)) });
    }

    return reply({ error: "Unknown provider" }, 404);
  } catch (thrown) {
    // A 500 makes the provider retry, which is right for a database hiccup.
    return reply({ error: String(thrown).slice(0, 300) }, 500);
  }
});
