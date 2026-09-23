import { z } from "zod";
import { CHANNEL_VALUES } from "./notifications-display";

// Everything that is not a schema lives in `notifications-display.ts` (no Zod).
export * from "./notifications-display";

const channelEnum = z.enum(CHANNEL_VALUES);

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
    (v) =>
      v.channel !== "email" ||
      !v.isEnabled ||
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.fromAddress ?? ""),
    { message: "An email channel needs a from-address", path: ["fromAddress"] },
  );

export type ChannelSettingsInput = z.infer<typeof channelSettingsSchema>;

/**
 * A discriminated union rather than one loose object, so "you picked a class
 * but did not choose which class" is a field error on the form instead of a
 * `null::uuid` cast blowing up inside the RPC.
 */
export const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("role"),
    role: z.string().min(1, "Choose a role"),
  }),
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
      ctx.addIssue({
        code: "custom",
        path: ["role"],
        message: "Choose a role",
      });
    }
    if (v.audienceKind === "section" && !v.sectionId) {
      ctx.addIssue({
        code: "custom",
        path: ["sectionId"],
        message: "Choose a class",
      });
    }
    if (v.audienceKind === "users" && v.userIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["userIds"],
        message: "Choose at least one person",
      });
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
      return {
        kind: "section",
        section_id: audience.sectionId,
        who: audience.who,
      };
    case "users":
      return { kind: "users", user_ids: audience.userIds };
    default:
      return { kind: "all" };
  }
}

export const templateSchema = z
  .object({
    eventKey: z.string().min(1, "Choose an event"),
    channel: channelEnum,
    subject: z.string().max(200).optional(),
    body: z.string().min(1, "A template needs a body").max(4000),
    isActive: z.boolean(),
    /**
     * WhatsApp only. The name of the template registered and approved with
     * Meta — this system never sees its text, only refers to it. `body` above
     * stays our own rendering, for the delivery log and for a channel added
     * later; the two can disagree, and knowing that is the point of keeping
     * both.
     */
    providerTemplateName: z.string().max(120).optional(),
    providerTemplateLocale: z.string().max(10).optional(),
    /** Which payload keys fill Meta's {{1}}, {{2}} — in that order. */
    providerTemplateParams: z.array(z.string().max(60)).max(10).optional(),
  })
  .refine((v) => v.channel === "whatsapp" || !v.providerTemplateName?.trim(), {
    message: "Only WhatsApp uses a registered template name",
    path: ["providerTemplateName"],
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
