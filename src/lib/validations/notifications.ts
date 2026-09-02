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
 * `live` is the honest bit. Only `in_app` has a driver; the rest queue real
 * delivery rows and nothing drains them, so every surface that offers a channel
 * has to say so rather than implying a message went out.
 */
export const CHANNELS = [
  {
    value: "in_app",
    label: "In-app",
    live: true,
    note: "Appears in the recipient's inbox immediately.",
  },
  {
    value: "email",
    label: "Email",
    live: false,
    note: "Queued. No email provider is connected yet, so nothing leaves the building.",
  },
  {
    value: "sms",
    label: "SMS",
    live: false,
    note: "Queued. No SMS gateway is connected yet.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    live: false,
    note: "Queued. No WhatsApp provider is connected yet.",
  },
  {
    value: "push",
    label: "Push",
    live: false,
    note: "Queued. No push service is connected yet.",
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

export function channelIsLive(value: string) {
  return CHANNELS.find((c) => c.value === value)?.live ?? false;
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
