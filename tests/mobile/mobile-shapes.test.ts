import { describe, expect, it } from "vitest";
import {
  MOBILE_API_VERSION,
  deviceRegistrationSchema,
  mobileBootstrapSchema,
  mobileHomeSchema,
  mobileStudentCardSchema,
  versionVerdict,
} from "@/lib/validations/mobile";

/**
 * The contract a phone depends on.
 *
 * The point of these is not that Zod works. It is that the *rule* is pinned: a
 * client this repository cannot redeploy must keep working when the server
 * starts sending more, and must be told plainly when it genuinely cannot.
 */
const card = {
  student: {
    student_id: "00000000-0000-4000-8000-000000000001",
    admission_number: "SOS-2025-0011",
    full_name: "Karan Joshi",
    photo_path: null,
    section_id: "00000000-0000-4000-8000-000000000002",
    section_label: "Grade 6 A",
    roll_number: "01",
    relationship: "father" as const,
  },
  timetable_today: [],
  attendance: {
    days_marked: 20,
    days_present: 18,
    days_absent: 2,
    days_late: 0,
    days_excused: 0,
  },
  fees: { charged: 18900, paid: 7560, balance: 11340, last_payment_at: null },
  homework_due: [],
  results: [],
  transport: null,
  hostel: null,
};

describe("the mobile contract", () => {
  it("parses a home document", () => {
    const result = mobileHomeSchema.safeParse({
      api_version: MOBILE_API_VERSION,
      on: "2026-09-07",
      unread_notifications: 0,
      notices: [],
      children: [card],
    });
    expect(result.success).toBe(true);
  });

  it("accepts keys it has never heard of, which is the additive rule", () => {
    // A client compiled in April must not break when the server starts sending
    // a field added in September. Removing `.passthrough()` would make every
    // additive change a breaking one.
    const result = mobileHomeSchema.safeParse({
      api_version: MOBILE_API_VERSION,
      on: "2026-09-07",
      unread_notifications: 0,
      notices: [],
      children: [{ ...card, something_added_later: { deeply: ["nested"] } }],
      also_new: true,
    });
    expect(result.success).toBe(true);
  });

  it("still refuses a document missing something it was promised", () => {
    const { attendance, ...withoutAttendance } = card;
    void attendance;
    expect(mobileStudentCardSchema.safeParse(withoutAttendance).success).toBe(false);
  });

  it("requires the relationship to be one the database can store", () => {
    expect(
      mobileStudentCardSchema.safeParse({
        ...card,
        student: { ...card.student, relationship: "uncle" },
      }).success,
    ).toBe(false);
  });

  it("parses a bootstrap document", () => {
    const result = mobileBootstrapSchema.safeParse({
      api_version: 1,
      min_supported_version: 1,
      today: "2026-09-06",
      school: {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Rajesh Kumar Mahavidyalaya",
        slug: "rajesh-kumar-mahavidyalaya",
        timezone: "Asia/Kolkata",
      },
      session: { id: "00000000-0000-4000-8000-000000000004", name: "2025-2026" },
      me: {
        user_id: "00000000-0000-4000-8000-000000000005",
        role: "parent",
        name: "Rajesh Kumar",
        is_student: false,
        is_guardian: true,
        is_staff: false,
      },
      permissions: ["fees.view"],
      students: [card.student],
      channels: [{ channel: "in_app", is_enabled: true, provider_configured: null }],
      unread_notifications: 3,
    });
    expect(result.success).toBe(true);
  });
});

describe("whether a build may still talk to the server", () => {
  const doc = { api_version: 3, min_supported_version: 2 };

  it("turns away a build older than the minimum, with a reason", () => {
    const verdict = versionVerdict(1, doc);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.sentence).toContain("Update");
  });

  it("lets the minimum itself through", () => {
    expect(versionVerdict(2, doc).ok).toBe(true);
  });

  it("lets a client newer than the server through, because rollouts are staged", () => {
    // The contract is additive, so an older document still parses in a newer
    // client. Treating this as an error would break every staged release.
    expect(versionVerdict(9, doc).ok).toBe(true);
  });
});

describe("registering a device", () => {
  it("refuses something that is obviously not a token", () => {
    expect(
      deviceRegistrationSchema.safeParse({ pushToken: "abc", platform: "ios" }).success,
    ).toBe(false);
  });

  it("refuses a platform the database would refuse", () => {
    expect(
      deviceRegistrationSchema.safeParse({
        pushToken: "a-token-long-enough",
        platform: "blackberry",
      }).success,
    ).toBe(false);
  });

  it("accepts a registration with only what a phone always knows", () => {
    expect(
      deviceRegistrationSchema.safeParse({
        pushToken: "a-token-long-enough",
        platform: "android",
      }).success,
    ).toBe(true);
  });
});
