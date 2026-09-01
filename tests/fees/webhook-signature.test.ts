import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * The Razorpay webhook signature check, kept honest.
 *
 * `supabase/functions/razorpay-webhook/index.ts` runs on Deno and cannot be
 * imported here, so this reproduces its two functions verbatim and pins the
 * algorithm against what Razorpay itself computes. If someone "simplifies" the
 * Edge Function — swaps the hash, compares the parsed object instead of the raw
 * body, drops the constant-time compare — these assertions are what should
 * have caught it.
 *
 * That check is the only thing between the open internet and a function that
 * books money: it runs with JWT verification off, because a payment gateway
 * cannot present one.
 */

const encoder = new TextEncoder();

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.webcrypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.webcrypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SECRET = "whsec_example_secret";

const BODY = JSON.stringify({
  event: "payment_link.paid",
  payload: {
    payment_link: { entity: { id: "plink_ABC" } },
    payment: { entity: { id: "pay_XYZ", amount: 500_000, method: "upi" } },
  },
});

/** What Razorpay computes: hex HMAC-SHA256 over the raw body. */
function razorpaySignature(secret: string, body: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("razorpay webhook signature", () => {
  it("computes the same signature Razorpay does", async () => {
    expect(await hmacSha256Hex(SECRET, BODY)).toBe(razorpaySignature(SECRET, BODY));
  });

  it("accepts a genuine signature", async () => {
    expect(timingSafeEqual(await hmacSha256Hex(SECRET, BODY), razorpaySignature(SECRET, BODY))).toBe(
      true,
    );
  });

  it("rejects a body whose amount was altered in flight", async () => {
    const tampered = BODY.replace('"amount":500000', '"amount":1');
    expect(
      timingSafeEqual(await hmacSha256Hex(SECRET, tampered), razorpaySignature(SECRET, BODY)),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", async () => {
    expect(
      timingSafeEqual(await hmacSha256Hex("not-the-secret", BODY), razorpaySignature(SECRET, BODY)),
    ).toBe(false);
  });

  it("rejects an empty or truncated signature", async () => {
    const real = razorpaySignature(SECRET, BODY);
    expect(timingSafeEqual("", real)).toBe(false);
    expect(timingSafeEqual(real.slice(0, -2), real)).toBe(false);
  });

  it("proves the raw body must be verified, not a re-serialised one", async () => {
    // The reason the Edge Function reads req.text() once and verifies before
    // parsing. Re-serialising changes the bytes, so a JSON.parse/stringify
    // round trip would break every signature -- and the tempting "fix" for
    // that is to stop checking.
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(
      timingSafeEqual(await hmacSha256Hex(SECRET, reserialised), razorpaySignature(SECRET, BODY)),
    ).toBe(false);
  });
});
