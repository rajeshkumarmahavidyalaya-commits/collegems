import { z } from "zod";

/**
 * The mobile API's contract, written down where a test can hold it.
 *
 * The documents are assembled in Postgres (`mobile_bootstrap`, `mobile_home`,
 * `mobile_student`) and consumed by a phone this repository does not contain.
 * That is exactly why the shapes live here: a contract nobody can run is a
 * contract that drifts, and the first person to notice would be a parent whose
 * app went blank.
 *
 * THE VERSIONING RULE, which is the whole reason this file is not just types:
 *
 *   - A web client is redeployed with the server. A phone is not — somebody is
 *     still running last April's build.
 *   - So within a version, changes are **additive only**. A new key is safe.
 *     A renamed or removed key is not, and `.passthrough()` below is deliberate:
 *     an old client must keep working when the server starts sending more.
 *   - A breaking change is a new function (`mobile_home_v2`) and a bumped
 *     `MOBILE_API_VERSION`, with the old one kept until nobody is on it.
 *   - `min_supported_version` is the other half. Raise it only when a released
 *     build genuinely cannot render the document, and never lower it: telling a
 *     person to update and then telling them they need not is worse than either
 *     answer alone.
 */
export const MOBILE_API_VERSION = 1;

export const mobileStudentSchema = z
  .object({
    student_id: z.string().uuid(),
    admission_number: z.string().nullable(),
    full_name: z.string(),
    photo_path: z.string().nullable(),
    section_id: z.string().uuid().nullable(),
    section_label: z.string().nullable(),
    roll_number: z.string().nullable(),
    relationship: z.enum(["self", "father", "mother", "guardian", "other"]),
  })
  .passthrough();

export const mobileLessonSchema = z
  .object({
    period: z.number().nullable(),
    starts_at: z.string().nullable(),
    ends_at: z.string().nullable(),
    subject: z.string().nullable(),
    teacher: z.string().nullable(),
    room: z.string().nullable(),
  })
  .passthrough();

export const mobileAttendanceSchema = z
  .object({
    days_marked: z.number(),
    days_present: z.number(),
    days_absent: z.number(),
    days_late: z.number(),
    days_excused: z.number(),
  })
  .passthrough();

export const mobileFeesSchema = z
  .object({
    charged: z.number(),
    paid: z.number(),
    balance: z.number(),
    last_payment_at: z.string().nullable(),
  })
  .passthrough();

export const mobileHomeworkSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    subject: z.string().nullable(),
    due_on: z.string().nullable(),
    status: z.string().nullable(),
    collects_submissions: z.boolean(),
  })
  .passthrough();

export const mobileResultSchema = z
  .object({
    exam_id: z.string().uuid(),
    exam: z.string(),
    percentage: z.number().nullable(),
    grade: z.string().nullable(),
    result: z.string().nullable(),
    rank_in_cohort: z.number().nullable(),
    cohort_size: z.number().nullable(),
  })
  .passthrough();

/** One child, as the home screen and the detail screen both start from. */
export const mobileStudentCardSchema = z
  .object({
    student: mobileStudentSchema,
    timetable_today: z.array(mobileLessonSchema),
    attendance: mobileAttendanceSchema.nullable(),
    fees: mobileFeesSchema.nullable(),
    homework_due: z.array(mobileHomeworkSchema),
    results: z.array(mobileResultSchema),
    transport: z.unknown().nullable(),
    hostel: z.unknown().nullable(),
  })
  .passthrough();

export const mobileNoticeSchema = z
  .object({
    delivery_id: z.string().uuid(),
    subject: z.string().nullable(),
    body: z.string(),
    event_key: z.string(),
    created_at: z.string(),
    read_at: z.string().nullable(),
  })
  .passthrough();

export const mobileHomeSchema = z
  .object({
    api_version: z.number(),
    on: z.string(),
    unread_notifications: z.number(),
    notices: z.array(mobileNoticeSchema),
    children: z.array(mobileStudentCardSchema),
  })
  .passthrough();

export const mobileBootstrapSchema = z
  .object({
    api_version: z.number(),
    min_supported_version: z.number(),
    today: z.string(),
    school: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        timezone: z.string(),
      })
      .passthrough(),
    session: z
      .object({ id: z.string().uuid(), name: z.string() })
      .passthrough()
      .nullable(),
    me: z
      .object({
        user_id: z.string().uuid(),
        role: z.string().nullable(),
        name: z.string().nullable(),
        is_student: z.boolean(),
        is_guardian: z.boolean(),
        is_staff: z.boolean(),
      })
      .passthrough(),
    permissions: z.array(z.string()),
    students: z.array(mobileStudentSchema),
    channels: z.array(
      z
        .object({
          channel: z.string(),
          is_enabled: z.boolean(),
          provider_configured: z.boolean().nullable(),
        })
        .passthrough(),
    ),
    unread_notifications: z.number(),
  })
  .passthrough();

export type MobileBootstrap = z.infer<typeof mobileBootstrapSchema>;
export type MobileHome = z.infer<typeof mobileHomeSchema>;
export type MobileStudentCard = z.infer<typeof mobileStudentCardSchema>;

export const PLATFORMS = [
  { value: "ios", label: "iPhone / iPad" },
  { value: "android", label: "Android" },
  { value: "web", label: "Web push" },
] as const;

export type Platform = (typeof PLATFORMS)[number]["value"];

/**
 * What a phone sends to register itself. The token is a **capability** — anyone
 * holding it and the provider's key can push a notification to that handset
 * that looks like the school's — so it is never logged, never shown on a
 * screen, and `devices` has no admin read policy.
 */
export const deviceRegistrationSchema = z.object({
  pushToken: z.string().min(8, "That does not look like a push token").max(4096),
  platform: z.enum(["ios", "android", "web"]),
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(40).optional(),
  deviceName: z.string().max(80).optional(),
  locale: z.string().max(20).optional(),
});
export type DeviceRegistrationInput = z.infer<typeof deviceRegistrationSchema>;

/**
 * Whether a build may still talk to this server. Returns a sentence rather than
 * a boolean because "update the app" with no reason is the least actionable
 * thing a screen can say.
 */
export function versionVerdict(
  clientVersion: number,
  doc: { api_version: number; min_supported_version: number },
): { ok: true } | { ok: false; sentence: string } {
  if (clientVersion < doc.min_supported_version) {
    return {
      ok: false,
      sentence: `This version of the app is too old for your school's system. Update to continue.`,
    };
  }
  if (clientVersion > doc.api_version) {
    // A client newer than the server happens during a staged rollout. It is not
    // an error: the contract is additive, so the older document still parses.
    return { ok: true };
  }
  return { ok: true };
}
