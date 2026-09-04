import { z } from "zod";

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
export const CHANNELS = [
  {
    value: "in_app",
    label: "In-app",
    driver: "built",
    note: "Appears in the recipient's inbox immediately.",
  },
  {
    value: "email",
    label: "Email",
    driver: "built",
    note: "Sent by the dispatcher once an email provider is connected.",
  },
  {
    value: "sms",
    label: "SMS",
    driver: "built",
    note: "Sent by the dispatcher once an SMS gateway is connected.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    driver: "none",
    note: "This build has no WhatsApp driver. Messages are kept, not sent.",
  },
  {
    value: "push",
    label: "Push",
    driver: "none",
    note: "This build has no push driver. Messages are kept, not sent.",
  },
] as const;

export type ChannelValue = (typeof CHANNELS)[number]["value"];

export const CHANNEL_VALUES = CHANNELS.map((c) => c.value) as [ChannelValue, ...ChannelValue[]];

const channelEnum = z.enum(CHANNEL_VALUES);

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
    return { kind: "live", sentence: "Appears in the recipient's inbox immediately." };
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
      sentence: "Turned off for this school. Queued messages are kept and will go out if you turn it on.",
    };
  }

  if (status.providerConfigured === null) {
    // Never attempted is a different thing from attempted and unconfigured, and
    // a screen that conflates them tells a school its email is broken when in
    // fact nothing has ever tried.
    return {
      kind: "held",
      sentence: "The dispatcher has not run yet, so nothing has been sent on this channel.",
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

export const channelSettingsSchema = z
  .object({
    channel: channelEnum,
    isEnabled: z.boolean(),
    fromAddress: z.string().max(200).optional(),
    senderName: z.string().max(120).optional(),
  })
  .refine((v) => v.channel !== "in_app", {
    message: "In-app is not a provider and cannot be turned off",
    path: ["channel"],
  })
  .refine(
    (v) => v.channel !== "email" || !v.isEnabled || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.fromAddress ?? ""),
    { message: "An email channel needs a from-address", path: ["fromAddress"] },
  );
export type ChannelSettingsInput = z.infer<typeof channelSettingsSchema>;

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
 * A discriminated union rather than one loose object, so "you picked a class
 * but did not choose which class" is a field error on the form instead of a
 * `null::uuid` cast blowing up inside the RPC.
 */
export const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("role"), role: z.string().min(1, "Choose a role") }),
  z.object({
    kind: z.literal("section"),
    sectionId: z.string().uuid("Choose a class"),
    who: z.enum(["students", "parents", "both"]),
  }),
  z.object({
    kind: z.literal("users"),
    userIds: z.array(z.string().uuid()).min(1, "Choose at least one person"),
  }),
]);
export type AudienceInput = z.infer<typeof audienceSchema>;

/**
 * The compose form is flat because react-hook-form is flat — the union above is
 * rebuilt from these fields on submit, which is also where "class chosen but no
 * class picked" turns into a field error.
 */
export const composeSchema = z
  .object({
    eventKey: z.string().min(1, "Choose what kind of message this is"),
    subject: z.string().max(200).optional(),
    body: z.string().min(1, "A message needs a body").max(4000),
    channels: z.array(channelEnum).min(1, "Choose at least one channel"),
    audienceKind: z.enum(["all", "role", "section", "users"]),
    role: z.string().optional(),
    sectionId: z.string().optional(),
    who: z.enum(["students", "parents", "both"]),
    userIds: z.array(z.string().uuid()),
  })
  .superRefine((v, ctx) => {
    if (v.audienceKind === "role" && !v.role) {
      ctx.addIssue({ code: "custom", path: ["role"], message: "Choose a role" });
    }
    if (v.audienceKind === "section" && !v.sectionId) {
      ctx.addIssue({ code: "custom", path: ["sectionId"], message: "Choose a class" });
    }
    if (v.audienceKind === "users" && v.userIds.length === 0) {
      ctx.addIssue({ code: "custom", path: ["userIds"], message: "Choose at least one person" });
    }
  });
export type ComposeInput = z.infer<typeof composeSchema>;

/** Turn the flat form into the JSON `notify_send` expects. */
export function toAudience(input: ComposeInput): AudienceInput {
  switch (input.audienceKind) {
    case "role":
      return { kind: "role", role: input.role! };
    case "section":
      return { kind: "section", sectionId: input.sectionId!, who: input.who };
    case "users":
      return { kind: "users", userIds: input.userIds };
    default:
      return { kind: "all" };
  }
}

/** The RPC's own JSON key names, which are snake_case where the form is camel. */
export function audienceToJson(audience: AudienceInput) {
  switch (audience.kind) {
    case "role":
      return { kind: "role", role: audience.role };
    case "section":
      return { kind: "section", section_id: audience.sectionId, who: audience.who };
    case "users":
      return { kind: "users", user_ids: audience.userIds };
    default:
      return { kind: "all" };
  }
}

export const templateSchema = z.object({
  eventKey: z.string().min(1, "Choose an event"),
  channel: channelEnum,
  subject: z.string().max(200).optional(),
  body: z.string().min(1, "A template needs a body").max(4000),
  isActive: z.boolean(),
});
export type TemplateInput = z.infer<typeof templateSchema>;

export const preferenceSchema = z.object({
  eventKey: z.string().min(1),
  channel: channelEnum,
  enabled: z.boolean(),
});
export type PreferenceInput = z.infer<typeof preferenceSchema>;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function channelLabel(value: string) {
  return CHANNELS.find((c) => c.value === value)?.label ?? value;
}

/**
 * Whether this build has a driver for the channel at all. NOT "will a message
 * be sent" — that needs `channelState` and a status row, because the answer
 * also depends on the school's settings and on what the dispatcher found.
 */
export function channelHasDriver(value: string) {
  return CHANNELS.find((c) => c.value === value)?.driver === "built";
}

export function statusLabel(value: string) {
  return DELIVERY_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export function audienceKindLabel(value: string) {
  return AUDIENCE_KINDS.find((a) => a.value === value)?.label ?? value;
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
export function relativeTime(iso: string, now: Date = new Date()) {
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

  return then.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
