/**
 * One driver per channel, and nothing else in this repository knows how a
 * message travels.
 *
 * The interface is deliberately two methods rather than one. `configure` is
 * asked *before* anything is claimed, and its answer is written back to
 * `notification_channel_settings.provider_configured` -- which is what the claim
 * query reads. A dispatcher that only tried to send would turn a missing API
 * key into a thousand failed deliveries with five attempts each; a dispatcher
 * that reports first turns it into one sentence on a screen.
 *
 * Adding a channel is a file here plus a line in `DRIVERS`. That is the whole
 * point of rule 10: a new channel is a driver, not a migration through twelve
 * modules.
 */

import { accessTokenFor, isPermanentFailure, readCredentials } from "./fcm.ts";
import {
  isPermanentFailure as isPermanentWhatsAppFailure,
  normaliseNumber,
  readCredentials as readWhatsAppCredentials,
  readTemplate,
} from "./whatsapp.ts";

export type Channel = "email" | "sms" | "whatsapp" | "push";

export type OutgoingMessage = {
  address: string;
  subject: string | null;
  body: string;
  fromAddress: string | null;
  senderName: string | null;
  /**
   * Frozen onto the delivery at compose time for the one channel that cannot
   * take a string. Null everywhere else -- see `whatsapp.ts` for why WhatsApp
   * is different in kind rather than in detail.
   */
  providerTemplate?: string | null;
  providerParams?: unknown;
};

export type SendResult =
  | { ok: true; ref: string | null }
  | {
      ok: false;
      error: string;
      /**
       * The address itself is dead -- not the provider having a bad minute.
       * The dispatcher fails the delivery at once instead of backing off, and
       * for push the device is revoked in the same statement. Retrying a
       * rotated push token gets the same answer for ever, and costs five
       * requests and five lines of log per message until somebody notices.
       */
      permanent?: boolean;
    };

export type Driver = {
  channel: Channel;
  provider: string;
  /**
   * Can this deployment send on this channel, for this school, right now?
   * A reason is required when it cannot -- it is what the screen shows, and
   * "not configured" with no explanation is the same as saying nothing.
   */
  configure(fromAddress: string | null): { ok: true } | { ok: false; reason: string };
  send(message: OutgoingMessage): Promise<SendResult>;
};

/** Providers describe their failures at length; a delivery row wants a line. */
function short(text: string, limit = 400): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

async function errorText(response: Response): Promise<string> {
  try {
    return short(await response.text());
  } catch {
    return `HTTP ${response.status}`;
  }
}

// ---------------------------------------------------------------------------
// Email -- Resend
// ---------------------------------------------------------------------------

const email: Driver = {
  channel: "email",
  provider: "resend",

  configure(fromAddress) {
    if (!Deno.env.get("RESEND_API_KEY")) {
      return {
        ok: false,
        reason:
          "No email provider is connected. Set RESEND_API_KEY on this Edge Function to enable email.",
      };
    }
    if (!fromAddress) {
      return {
        ok: false,
        reason:
          "Email is connected but this school has no from-address. Set one under Notifications → Channels.",
      };
    }
    return { ok: true };
  },

  async send({ address, subject, body, fromAddress, senderName }) {
    const from = senderName ? `${senderName} <${fromAddress}>` : fromAddress!;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [address],
        subject: subject ?? "A message from your school",
        // Plain text, not HTML. Every message in this system is composed from a
        // template a person typed into a textarea, so rendering it as HTML
        // would turn an apostrophe in a child's name into markup and a stray
        // angle bracket into a hole.
        text: body,
      }),
    });

    if (!response.ok) return { ok: false, error: await errorText(response) };

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, ref: payload.id ?? null };
  },
};

// ---------------------------------------------------------------------------
// SMS -- Twilio
// ---------------------------------------------------------------------------

const sms: Driver = {
  channel: "sms",
  provider: "twilio",

  configure(fromAddress) {
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!sid || !token) {
      return {
        ok: false,
        reason:
          "No SMS gateway is connected. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN on this Edge Function to enable SMS.",
      };
    }
    if (!fromAddress && !Deno.env.get("TWILIO_FROM_NUMBER")) {
      return {
        ok: false,
        reason:
          "SMS is connected but there is no sender number. Set one under Notifications → Channels.",
      };
    }
    return { ok: true };
  },

  async send({ address, body, fromAddress }) {
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const from = fromAddress ?? Deno.env.get("TWILIO_FROM_NUMBER")!;

    const form = new URLSearchParams({ To: address, From: from, Body: body });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );

    if (!response.ok) return { ok: false, error: await errorText(response) };

    const payload = (await response.json().catch(() => ({}))) as { sid?: string };
    return { ok: true, ref: payload.sid ?? null };
  },
};

// ---------------------------------------------------------------------------
// Push -- Firebase Cloud Messaging
// ---------------------------------------------------------------------------

const push: Driver = {
  channel: "push",
  provider: "fcm",

  configure() {
    // `fromAddress` is ignored: a push notification has no sender address, and
    // the school's name travels in the notification's own title instead. This
    // is the one channel where an unconfigured *school* is not a possible
    // state -- either the deployment has FCM credentials or it does not.
    if (!readCredentials()) {
      return {
        ok: false,
        reason:
          "No push service is connected. Set FCM_SERVICE_ACCOUNT on this Edge Function " +
          "to the Firebase service-account JSON to enable push.",
      };
    }
    return { ok: true };
  },

  async send({ address, subject, body, senderName }) {
    const credentials = readCredentials();
    if (!credentials) {
      return { ok: false, error: "Push credentials went away mid-run.", permanent: false };
    }

    let token: string;
    try {
      token = await accessTokenFor(credentials);
    } catch (thrown) {
      // An auth failure is the deployment's problem, never the handset's, so
      // it must not revoke a device.
      return { ok: false, error: String(thrown).slice(0, 400), permanent: false };
    }

    const title = subject ?? senderName ?? "A message from your school";

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: address,
            // `notification` rather than a data-only message: this has to
            // appear on a locked screen without the app being awake, which is
            // the entire point of sending it.
            notification: { title, body },
            // Web push needs the title again in its own block; Android and iOS
            // read the shared one. Sending all three is what makes a single
            // driver cover `devices.platform` without branching per handset.
            android: { priority: "high", notification: { channel_id: "schoolos" } },
            apns: {
              headers: { "apns-priority": "10" },
              payload: { aps: { sound: "default" } },
            },
            webpush: { notification: { title, body } },
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await errorText(response);
      return {
        ok: false,
        error: detail,
        permanent: isPermanentFailure(response.status, detail),
      };
    }

    const payload = (await response.json().catch(() => ({}))) as { name?: string };
    // FCM returns `projects/<id>/messages/<id>`; the tail is what support asks
    // for, and it is what a delivery-receipt callback would match on.
    return { ok: true, ref: payload.name?.split("/").pop() ?? null };
  },
};

// ---------------------------------------------------------------------------
// WhatsApp -- Meta Cloud API
// ---------------------------------------------------------------------------

const whatsapp: Driver = {
  channel: "whatsapp",
  provider: "meta",

  configure(fromAddress) {
    // `fromAddress` is the school's own WhatsApp Business phone number ID where
    // it has one; the deployment's is the fallback. The access token is always
    // the deployment's -- it is a secret, and secrets do not live in a table a
    // school can edit.
    if (!Deno.env.get("WHATSAPP_ACCESS_TOKEN")) {
      return {
        ok: false,
        reason:
          "No WhatsApp provider is connected. Set WHATSAPP_ACCESS_TOKEN and " +
          "WHATSAPP_PHONE_NUMBER_ID on this Edge Function to enable WhatsApp.",
      };
    }
    if (!readWhatsAppCredentials(fromAddress)) {
      return {
        ok: false,
        reason:
          "WhatsApp is connected but there is no sender number. Set this school's " +
          "WhatsApp phone number ID under Notifications \u2192 Channels, or set " +
          "WHATSAPP_PHONE_NUMBER_ID for every school on this deployment.",
      };
    }
    return { ok: true };
  },

  async send({ address, body, fromAddress, providerTemplate, providerParams }) {
    const credentials = readWhatsAppCredentials(fromAddress);
    if (!credentials) {
      return { ok: false, error: "WhatsApp credentials went away mid-run.", permanent: false };
    }

    const to = normaliseNumber(address);
    if (!to) {
      return {
        ok: false,
        error:
          `"${address}" is not a number WhatsApp can deliver to. It needs the full ` +
          "international number, including the country code.",
        // Retrying will not add a country code.
        permanent: true,
      };
    }

    const template = readTemplate(providerTemplate ?? null, providerParams);
    if (!template) {
      // Should be unreachable: `notify_send` skips these at compose time rather
      // than queueing them. Kept because "unreachable" and "never happens" are
      // different, and free text would be rejected by Meta anyway.
      return {
        ok: false,
        error:
          "No WhatsApp template was recorded for this message, and WhatsApp does not " +
          "accept free text outside a conversation the recipient started.",
        permanent: true,
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(credentials.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.locale },
            // Meta rejects an empty `components` array, so it is only sent when
            // the template actually has placeholders to fill.
            ...(template.params.length > 0
              ? {
                  components: [
                    {
                      type: "body",
                      parameters: template.params.map((text) => ({ type: "text", text })),
                    },
                  ],
                }
              : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await errorText(response);
      return {
        ok: false,
        error: detail,
        permanent: isPermanentWhatsAppFailure(response.status, detail),
      };
    }

    const payload = (await response.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
    };
    // `body` is our own rendering of the message, kept for the delivery log.
    // What Meta actually sent is its approved copy of the template, which this
    // system has never seen -- worth remembering when the two disagree.
    void body;
    return { ok: true, ref: payload.messages?.[0]?.id ?? null };
  },
};

// ---------------------------------------------------------------------------
// The channels with no driver yet
// ---------------------------------------------------------------------------

/**
 * A stub for a channel this build cannot send on. Nothing uses it today --
 * every channel in `CHANNELS` now has a driver -- and it is kept because the
 * next channel added will need a row reported for it before its driver exists.
 * Without a stub the channel has no row at all, and a null
 * `provider_configured` reads on screen as "never tried" rather than as "this
 * build cannot do that".
 */
export function unbuilt(channel: Channel, reason: string): Driver {
  return {
    channel,
    provider: "none",
    configure: () => ({ ok: false, reason }),
    // Permanent: there is no build in which this will start working, so
    // retrying it four more times helps nobody.
    send: () => Promise.resolve({ ok: false, error: reason, permanent: true }),
  };
}

export const DRIVERS: Driver[] = [email, sms, push, whatsapp];
