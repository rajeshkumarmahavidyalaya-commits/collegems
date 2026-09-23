import { z } from "zod";
import { LIVE_CLASS_PROVIDERS, LIVE_CLASS_URL_PATTERNS, type LiveClassProvider } from "./live-classes-display";

export * from "./live-classes-display";

/**
 * Scheduling a live lesson, at the server boundary.
 *
 * `live_class_schedule` is the gate: it re-checks every field, and the table's
 * CHECK and exclusion constraints enforce the address and the overlap whatever
 * calls it. This schema exists so the common mistakes -- a Zoom link pasted
 * into the Meet option, a length of 0 -- are named beside the field.
 */
export const scheduleSchema = z
  .object({
    course: z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/, "Choose a class and subject"),
    title: z.string().trim().min(1, "Give the lesson a title").max(120),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a start time"),
    minutes: z.string().regex(/^\d{1,3}$/, "Give a length in minutes"),
    provider: z.enum(LIVE_CLASS_PROVIDERS.map((p) => p.value) as [LiveClassProvider, ...LiveClassProvider[]]),
    joinUrl: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    const minutes = Number(v.minutes);
    if (!(minutes >= 5 && minutes <= 300)) {
      ctx.addIssue({ code: "custom", path: ["minutes"], message: "Between 5 and 300 minutes" });
    }
    if (v.provider !== "jitsi") {
      const name = LIVE_CLASS_PROVIDERS.find((p) => p.value === v.provider)!.name;
      if (!v.joinUrl) {
        ctx.addIssue({ code: "custom", path: ["joinUrl"], message: `Paste the ${name} link` });
      } else if (!LIVE_CLASS_URL_PATTERNS[v.provider].test(v.joinUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["joinUrl"],
          message: `That is not a ${name} meeting link. Copy it from the meeting's invitation.`,
        });
      }
    }
  });

export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const cancelSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, "Say why -- the families will see it").max(300),
});
