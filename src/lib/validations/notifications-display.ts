import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * `notifications.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `notifications.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
/**
 * Phase 4.1 — the one way anything in this system tells somebody something.
 *
 * The shapes here mirror `notify_send`'s arguments exactly, because the server
 * action is a thin pass-through: the interesting logic (audience resolution,
 * template rendering, preference filtering, fan-out) all lives in Postgres
 * where it can be one transaction.
 */

/**
 * Channels, in the order a school thinks about them: the one that always works
 * first, then the ones that cost money.
 *
 * `driver` is a fact about **this codebase**: whether `notify-dispatch` knows
 * how to send on the channel at all. It is not the same question as whether a
 * message will actually leave the building, and conflating the two is what this
 * file used to do — a `live: false` constant was the truth while the answer was
 * "never, for anybody", and became a lie the moment a driver shipped.
 *
 * The other two thirds of the answer are runtime facts and live in Postgres:
 * `notification_channel_settings.is_enabled` (has this school turned it on and
 * given it an address) and `provider_configured` (did the dispatcher find its
 * credentials). `channelState` below is the one place those three are combined,
 * and every surface that offers a channel goes through it.
 */
/**
 * Whether *this build* has a sender for a channel. Written as an explicit type
 * rather than left to inference: every channel happens to be `"built"` today,
 * and without this the compiler narrows the union and declares the "no driver"
 * branch in `channelState` unreachable — deleting a branch that the next
 * channel added will need, and that `unbuilt()` in the dispatcher exists to
 * feed.
 */
export type DriverAvailability = "built" | "none";

export const CHANNELS = [
  {
    value: "in_app",
    label: "In-app",
    driver: "built" as DriverAvailability,
    note: "Appears in the recipient's inbox immediately.",
  },
  {
    value: "email",
    label: "Email",
    driver: "built" as DriverAvailability,
    note: "Sent by the dispatcher once an email provider is connected.",
  },
  {
    value: "sms",
    label: "SMS",
    driver: "built" as DriverAvailability,
    note: "Sent by the dispatcher once an SMS gateway is connected.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    driver: "built" as DriverAvailability,
    note: "Sent by the dispatcher as an approved template once WhatsApp is connected.",
  },
  {
    value: "push",
    label: "Push",
    driver: "built" as DriverAvailability,
    note: "Sent by the dispatcher to registered devices once push is connected.",
  },
] as const;

export type ChannelValue = (typeof CHANNELS)[number]["value"];

export const CHANNEL_VALUES = CHANNELS.map((c) => c.value) as [
  ChannelValue,
  ...ChannelValue[],
];

export const DELIVERY_STATUSES = [
  { value: "queued", label: "Queued", tone: "muted" },
  { value: "sending", label: "Sending", tone: "info" },
  { value: "sent", label: "Sent", tone: "success" },
  { value: "failed", label: "Failed", tone: "danger" },
  { value: "skipped", label: "Skipped", tone: "warning" },
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]["value"];

// ---------------------------------------------------------------------------
// Whether a channel actually sends, which has three parts
// ---------------------------------------------------------------------------

/** One row of `notify_channel_status()`, as the app sees it. */
export type ChannelStatus = {
  channel: ChannelValue;
  isEnabled: boolean;
  fromAddress: string | null;
  senderName: string | null;
  provider: string | null;
  providerConfigured: boolean | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  queued: number;
  oldestQueuedAt: string | null;
  failed: number;
  sentRecently: number;
};

export type ChannelState =
  /** Messages go out. */
  | { kind: "live"; sentence: string }
  /** Nothing goes out, and this says why, in one sentence a person can act on. */
  | { kind: "held"; sentence: string }
  /** Nothing will ever go out from this build. */
  | { kind: "unbuilt"; sentence: string };

/**
 * The single source of rule 10's honesty, and the reason it is a function
 * rather than a constant: the answer depends on the build, on the school's
 * settings, and on what the dispatcher last found. Getting any of the three
 * wrong produces a screen that says SMS is on while nothing leaves the
 * building — which is the exact failure this rule exists to prevent.
 *
 * The order of the checks is the order a person would ask them in, and each
 * branch names the next thing to do.
 */
export function channelState(status: ChannelStatus): ChannelState {
  const meta = CHANNELS.find((c) => c.value === status.channel);

  if (status.channel === "in_app") {
    // Not a provider. The row IS the delivery, so there is nothing to connect
    // and nothing that can be down.
    return {
      kind: "live",
      sentence: "Appears in the recipient's inbox immediately.",
    };
  }

  if (meta?.driver === "none") {
    return {
      kind: "unbuilt",
      sentence: `This build has no ${meta.label} driver. Messages queued for ${meta.label} are kept, not sent.`,
    };
  }

  if (!status.isEnabled) {
    return {
      kind: "held",
      sentence:
        "Turned off for this school. Queued messages are kept and will go out if you turn it on.",
    };
  }

  if (status.providerConfigured === null) {
    // Never attempted is a different thing from attempted and unconfigured, and
    // a screen that conflates them tells a school its email is broken when in
    // fact nothing has ever tried.
    return {
      kind: "held",
      sentence:
        "The dispatcher has not run yet, so nothing has been sent on this channel.",
    };
  }

  if (!status.providerConfigured) {
    return {
      kind: "held",
      sentence:
        status.lastError ??
        "The dispatcher could not find what it needs to send on this channel.",
    };
  }

  return {
    kind: "live",
    sentence: status.lastError
      ? `Connected via ${status.provider ?? "a provider"}, but the last attempt failed: ${status.lastError}`
      : `Connected via ${status.provider ?? "a provider"}.`,
  };
}

/** True only when a message chosen for this channel will actually be sent. */
export function channelSends(status: ChannelStatus): boolean {
  return channelState(status).kind === "live";
}

export const AUDIENCE_KINDS = [
  { value: "all", label: "Everyone with a login" },
  { value: "role", label: "A role" },
  { value: "section", label: "A class" },
  { value: "users", label: "Named people" },
] as const;

export const SECTION_WHO = [
  { value: "both", label: "Students and their parents" },
  { value: "students", label: "Students only" },
  { value: "parents", label: "Parents only" },
] as const;

/**
 * WhatsApp is the one channel where a template is not a convenience but the
 * only way to send at all: outside a 24-hour window opened by the recipient
 * writing first, Meta accepts nothing else. So a WhatsApp template row without
 * a registered name cannot send, and saying that plainly is more useful than
 * letting somebody discover it from a delivery log full of skips.
 */
export function templateProblem(template: {
  channel: string;
  providerTemplateName?: string | null;
}): string | null {
  if (template.channel !== "whatsapp") return null;
  if (template.providerTemplateName?.trim()) return null;
  return "WhatsApp needs the name of a template approved by Meta. Without one, messages for this event are skipped rather than sent.";
}

export function channelLabel(value: string, t: Translator) {
  const found = CHANNELS.find((c) => c.value === value);
  return found ? labelFor(`channel.${value}`, found.label, t) : value;
}

export function channelOptions(t: Translator) {
  return optionsFor(CHANNELS, "channel", t);
}

/**
 * Whether this build has a driver for the channel at all. NOT "will a message
 * be sent" — that needs `channelState` and a status row, because the answer
 * also depends on the school's settings and on what the dispatcher found.
 */
export function channelHasDriver(value: string) {
  return CHANNELS.find((c) => c.value === value)?.driver === "built";
}

export function statusLabel(value: string, t: Translator) {
  const found = DELIVERY_STATUSES.find((s) => s.value === value);
  return found ? labelFor(`delivery.status.${value}`, found.label, t) : value;
}

export function audienceKindLabel(value: string, t: Translator) {
  const found = AUDIENCE_KINDS.find((a) => a.value === value);
  return found ? labelFor(`audience.kind.${value}`, found.label, t) : value;
}

export function audienceKindOptions(t: Translator) {
  return optionsFor(AUDIENCE_KINDS, "audience.kind", t);
}

/**
 * `{{name}}` placeholders in a template body, de-duplicated and in first-use
 * order — so the template editor can show an author which variables their text
 * will actually consume without them guessing at the catalog.
 */
export function templateVariables(body: string): string[] {
  const found = body.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? [];
  const names = found.map((m) => m.replace(/[{}\s]/g, ""));
  return [...new Set(names)];
}

/** "3 minutes ago" / "yesterday" — relative time is what an inbox wants. */
export function relativeTime(
  iso: string,
  locale: Locale,
  now: Date = new Date(),
) {
  const then = new Date(iso);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);

  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  return formatDate(then, locale);
}
