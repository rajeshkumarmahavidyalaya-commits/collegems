import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  msg91Receipts,
  resendReceipt,
  twilioReceipt,
  twilioSignature,
  verifySvix,
  verifyTwilio,
} from "../../supabase/functions/notify-receipts/verify";

/**
 * Delivery receipts (0309), pinned without a database or a provider.
 *
 * Each signature is computed a second time here with Node's own `crypto`,
 * following the provider's documented algorithm, so the Web Crypto version the
 * Edge Function runs is checked against an independent implementation rather
 * than against itself. Every check has its negative control: a tampered body,
 * a wrong key, a stale timestamp.
 */
const ROOT = process.cwd();

function nodeTwilio(token: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(data).digest("base64");
}

function nodeSvix(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

describe("Twilio status callbacks", () => {
  const token = "twilio-test-token";
  const url = "https://example.supabase.co/functions/v1/notify-receipts?provider=twilio";
  const params = { MessageSid: "SM123", MessageStatus: "undelivered", ErrorCode: "30007", To: "+919876543210" };

  it("signs as Twilio documents it", async () => {
    expect(await twilioSignature(token, url, params)).toBe(nodeTwilio(token, url, params));
  });

  it("accepts the real signature and refuses a tampered report or a wrong key", async () => {
    const good = nodeTwilio(token, url, params);
    expect(await verifyTwilio(token, url, params, good)).toBe(true);
    expect(await verifyTwilio(token, url, { ...params, MessageStatus: "delivered" }, good)).toBe(false);
    expect(await verifyTwilio("another-token", url, params, good)).toBe(false);
    expect(await verifyTwilio(token, `${url}&x=1`, params, good)).toBe(false);
    expect(await verifyTwilio(token, url, params, null)).toBe(false);
  });

  it("reads only final outcomes", () => {
    expect(twilioReceipt(params)).toEqual({ channel: "sms", ref: "SM123", state: "undelivered", detail: "Twilio error 30007" });
    expect(twilioReceipt({ MessageSid: "SM1", MessageStatus: "delivered" })?.state).toBe("delivered");
    expect(twilioReceipt({ MessageSid: "SM1", MessageStatus: "failed" })?.state).toBe("undelivered");
    expect(twilioReceipt({ MessageSid: "SM1", MessageStatus: "sent" })).toBeNull();
    expect(twilioReceipt({ MessageStatus: "delivered" })).toBeNull();
  });
});

describe("Resend webhooks (Svix)", () => {
  const secret = "whsec_" + Buffer.from("resend-test-secret-32-bytes-long!").toString("base64");
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "em_1", bounce: { message: "Mailbox full" } } });
  const now = 1_790_000_000;

  it("accepts the real signature among several, and refuses tampering, a wrong key and a stale report", async () => {
    const sig = nodeSvix(secret, "msg_1", String(now), body);
    const headers = { id: "msg_1", timestamp: String(now), signature: `v1,bogus v1,${sig}` };
    expect(await verifySvix(secret, headers, body, now)).toBe(true);
    expect(await verifySvix(secret, headers, body.replace("bounced", "delivered"), now)).toBe(false);
    expect(await verifySvix("whsec_" + Buffer.from("another").toString("base64"), headers, body, now)).toBe(false);
    expect(await verifySvix(secret, headers, body, now + 301)).toBe(false);
    expect(await verifySvix(secret, { ...headers, signature: `v2,${sig}` }, body, now)).toBe(false);
  });

  it("reads delivered, bounced and complained, and nothing else", () => {
    expect(resendReceipt(JSON.parse(body))).toEqual({ channel: "email", ref: "em_1", state: "bounced", detail: "Mailbox full" });
    expect(resendReceipt({ type: "email.complained", data: { email_id: "em_2" } })?.state).toBe("complained");
    expect(resendReceipt({ type: "email.delivery_delayed", data: { email_id: "em_2" } })).toBeNull();
  });
});

describe("MSG91 delivery reports", () => {
  it("reads a request's first report, delivered or not, and skips the unreadable", () => {
    expect(
      msg91Receipts({
        data: [
          { requestId: "r1", report: [{ desc: "DELIVERED" }] },
          { requestId: "r2", report: [{ desc: "REJECTED" }] },
          { requestId: "r3", report: [{ desc: "PENDING" }] },
          { report: [{ desc: "DELIVERED" }] },
        ],
      }).map((r) => [r.ref, r.state]),
    ).toEqual([
      ["r1", "delivered"],
      ["r2", "undelivered"],
    ]);
  });
});

describe("the receipts function and the driver", () => {
  const code = (p: string) =>
    readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fn = code("supabase/functions/notify-receipts/index.ts");

  it("verifies each provider's report before parsing it, and fails closed without a secret", () => {
    for (const [verify, parse, secret] of [
      ["verifyTwilio(", "twilioReceipt(", "TWILIO_AUTH_TOKEN"],
      ["verifySvix(", "JSON.parse(raw)", "RESEND_WEBHOOK_SECRET"],
      ["timingSafeEqual(", "msg91Receipts(", "MSG91_RECEIPT_TOKEN"],
    ]) {
      expect(fn.indexOf(verify), verify).toBeGreaterThan(-1);
      expect(fn.indexOf(verify), verify).toBeLessThan(fn.indexOf(parse, fn.indexOf(secret)));
      expect(fn).toMatch(new RegExp(`if \\(!(secret|token \\|\\| !base)\\) return reply\\(\\{ error: "Receipts are not configured for`));
    }
  });

  it("the Twilio driver asks for callbacks at the one URL the function verifies", () => {
    expect(code("supabase/functions/notify-dispatch/drivers.ts")).toMatch(
      /form\.set\("StatusCallback", `\$\{receipts\}\?provider=twilio`\)/,
    );
    expect(fn).toMatch(/`\$\{base\}\?provider=twilio`/);
  });

  it("the database half is revoked from everybody holding a JWT", () => {
    const m = readFileSync(join(ROOT, "supabase/migrations/0309_a_daily_limit_and_what_actually_arrived.sql"), "utf8");
    expect(m).toMatch(/revoke all on function public\.notify_record_receipt\(text, text, text, text\) from public, anon, authenticated;/);
    expect(m).toMatch(/revoke all on function public\.sms_daily_remaining\(uuid\) from public, anon, authenticated;/);
    // A college at its limit contributes no SMS to the window at all.
    expect(m).toMatch(/and \(c\.channel <> 'sms' or b\.remaining is null or b\.remaining > 0\)/);
  });
});
