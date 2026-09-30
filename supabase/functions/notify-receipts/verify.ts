/**
 * The three ways a provider proves a delivery report is its own, and the
 * reading of each report into one of four outcomes.
 *
 * Plain Web Crypto and no `Deno` anywhere, so the same file runs in the Edge
 * Function and under vitest, where each signature is checked against an
 * independent Node implementation of the provider's documented algorithm
 * (`tests/notifications/receipts.test.ts`).
 */

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(hash: "SHA-1" | "SHA-256", key: Uint8Array<ArrayBuffer>, message: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["sign"]);
  return toBase64(await crypto.subtle.sign("HMAC", imported, encoder.encode(message)));
}

/** Constant time: a length-dependent early return leaks the signature. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Twilio: `X-Twilio-Signature` is base64(HMAC-SHA1(auth token, the full URL
 * Twilio called, followed by every POST parameter as name then value, sorted
 * by name)). The URL must be the exact one this system gave Twilio as
 * `StatusCallback`, which is why the caller passes it rather than reading the
 * request's own URL, which a gateway may have rewritten.
 */
export async function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return hmac("SHA-1", new Uint8Array(encoder.encode(authToken)), data);
}

export async function verifyTwilio(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  return timingSafeEqual(await twilioSignature(authToken, url, params), header);
}

/**
 * Resend signs its webhooks with Svix: base64(HMAC-SHA256(the base64 part of
 * the `whsec_` secret, `${svix-id}.${svix-timestamp}.${raw body}`)), sent in
 * `svix-signature` as one or more space-separated `v1,<signature>` entries.
 * A timestamp more than five minutes from now is refused, so a captured
 * report cannot be replayed later.
 */
export async function svixSignature(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = fromBase64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  return hmac("SHA-256", key, `${id}.${timestamp}.${body}`);
}

export async function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isFinite(sent) || Math.abs(nowSeconds - sent) > 300) return false;
  const expected = await svixSignature(secret, id, timestamp, body);
  return signature
    .split(" ")
    .map((entry) => entry.split(",", 2))
    .some(([version, value]) => version === "v1" && value !== undefined && timingSafeEqual(value, expected));
}

// ---------------------------------------------------------------------------
// What each provider's report means
// ---------------------------------------------------------------------------

export type Receipt = {
  channel: "sms" | "email";
  ref: string;
  state: "delivered" | "undelivered" | "bounced" | "complained";
  detail: string | null;
};

/**
 * Twilio posts a callback per status change. Only the final ones are an
 * outcome: `delivered`, and `undelivered` or `failed`. `queued`, `sent` and
 * the rest are progress, and are acknowledged and ignored.
 */
export function twilioReceipt(params: Record<string, string>): Receipt | null {
  const ref = params.MessageSid ?? params.SmsSid;
  const status = (params.MessageStatus ?? params.SmsStatus ?? "").toLowerCase();
  if (!ref) return null;
  if (status === "delivered") return { channel: "sms", ref, state: "delivered", detail: null };
  if (status === "undelivered" || status === "failed") {
    return { channel: "sms", ref, state: "undelivered", detail: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : status };
  }
  return null;
}

/** Resend: `email.delivered`, `email.bounced`, `email.complained`; the rest is progress. */
export function resendReceipt(event: unknown): Receipt | null {
  const e = event as { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  const ref = e?.data?.email_id;
  if (!ref) return null;
  switch (e.type) {
    case "email.delivered":
      return { channel: "email", ref, state: "delivered", detail: null };
    case "email.bounced":
      return { channel: "email", ref, state: "bounced", detail: e.data?.bounce?.message ?? null };
    case "email.complained":
      return { channel: "email", ref, state: "complained", detail: null };
    default:
      return null;
  }
}

/**
 * MSG91 delivery reports: a list of requests, each with a report per number.
 * The request id is what `sendhttp` returned and the driver stored as the
 * delivery's reference. A description containing DELIVERED is delivered;
 * anything final and not delivered (FAILED, REJECTED, NDNC, EXPIRED) is
 * undelivered. **Not exercised against the live gateway**: the shape is MSG91's
 * documented report format, read defensively.
 */
export function msg91Receipts(payload: unknown): Receipt[] {
  const list = Array.isArray(payload) ? payload : (payload as { data?: unknown })?.data;
  if (!Array.isArray(list)) return [];
  const out: Receipt[] = [];
  for (const request of list as { requestId?: string; report?: { desc?: string; status?: string }[] }[]) {
    const ref = request?.requestId;
    if (!ref || !Array.isArray(request.report) || request.report.length === 0) continue;
    const desc = String(request.report[0]?.desc ?? "").toUpperCase();
    if (/^DELIVERED/.test(desc)) out.push({ channel: "sms", ref, state: "delivered", detail: null });
    else if (/FAIL|REJECT|NDNC|EXPIRE|UNDELIV|BLOCK/.test(desc)) {
      out.push({ channel: "sms", ref, state: "undelivered", detail: desc.toLowerCase() });
    }
  }
  return out;
}
