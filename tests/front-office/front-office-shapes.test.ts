import { describe, expect, it } from "vitest";
import {
  conversionRate,
  durationPhrase,
  enquirySchema,
  ENQUIRY_STAGES,
  FOLLOW_UP_OUTCOMES,
  followUpPhrase,
  followUpSchema,
  isOverdue,
  stageIsOpen,
  stageLabel,
  stageTone,
  visitorSchema,
} from "@/lib/validations/front-office";

/**
 * Front office, browser half.
 *
 * Two of these pin decisions that are easy to get quietly wrong: what a
 * conversion rate is a share *of*, and which outcomes a note may set.
 */

describe("the funnel vocabulary", () => {
  it("keeps admitted and lost out of the open stages", () => {
    expect(ENQUIRY_STAGES.filter((s) => s.open).map((s) => s.value)).toEqual([
      "new",
      "contacted",
      "visited",
      "applied",
    ]);
    expect(stageIsOpen("admitted")).toBe(false);
    expect(stageIsOpen("lost")).toBe(false);
    expect(stageIsOpen("nonsense")).toBe(false);
  });

  // `admitted` means a student row exists, and only enquiry_convert can make
  // that true — the database refuses a note that claims it, so the form must
  // not offer it.
  it("never offers admitted as a note outcome", () => {
    expect(FOLLOW_UP_OUTCOMES.map((o) => o.value)).toEqual([
      "contacted",
      "visited",
      "applied",
      "lost",
    ]);
  });

  it("tones a stage without relying on colour to carry it", () => {
    expect(stageTone("admitted")).toBe("won");
    expect(stageTone("lost")).toBe("lost");
    expect(stageTone("visited")).toBe("open");
    expect(stageLabel("walk_in")).toBe("walk_in");
  });
});

describe("followUpPhrase", () => {
  const today = "2026-09-04";

  it("reads as a phrase, not a date to subtract", () => {
    expect(followUpPhrase("2026-09-04", today)).toBe("due today");
    expect(followUpPhrase("2026-09-05", today)).toBe("due tomorrow");
    expect(followUpPhrase("2026-09-03", today)).toBe("1 day overdue");
    expect(followUpPhrase("2026-08-30", today)).toBe("5 days overdue");
    expect(followUpPhrase("2026-09-10", today)).toBe("in 6 days");
  });

  it("says nothing when no follow-up is set", () => {
    expect(followUpPhrase(null, today)).toBeNull();
  });

  // A settled enquiry is never overdue, however old its last follow-up date.
  it("does not call a settled enquiry overdue", () => {
    expect(isOverdue("2026-08-01", "contacted", today)).toBe(true);
    expect(isOverdue("2026-08-01", "admitted", today)).toBe(false);
    expect(isOverdue("2026-08-01", "lost", today)).toBe(false);
    expect(isOverdue(null, "contacted", today)).toBe(false);
  });
});

describe("conversionRate", () => {
  // The decision worth pinning: a share of what *finished*, not of everything
  // ever logged. Counting open enquiries as failures makes the number
  // meaningless in November and flattering in March.
  it("is a share of settled enquiries, not of all of them", () => {
    const counts = [
      { status: "new", count: 20 },
      { status: "contacted", count: 10 },
      { status: "admitted", count: 6 },
      { status: "lost", count: 2 },
    ];
    expect(conversionRate(counts)).toBe(75);
  });

  it("is null before anything has settled", () => {
    expect(conversionRate([{ status: "new", count: 9 }])).toBeNull();
    expect(conversionRate([])).toBeNull();
  });

  it("is zero when everything settled was lost", () => {
    expect(conversionRate([{ status: "lost", count: 4 }])).toBe(0);
  });
});

describe("durationPhrase", () => {
  it("reads hours and minutes", () => {
    expect(durationPhrase(40)).toBe("40 m");
    expect(durationPhrase(60)).toBe("1 h 0 m");
    expect(durationPhrase(100)).toBe("1 h 40 m");
    expect(durationPhrase(null)).toBe("—");
    expect(durationPhrase(-5)).toBe("0 m");
  });
});

describe("form shapes", () => {
  const base = {
    applicantFirstName: "Aarav",
    contactName: "Sunita Khanna",
    source: "phone" as const,
  };

  // The one rule that makes the module worth having.
  it("refuses an enquiry nobody can ring back", () => {
    expect(enquirySchema.safeParse(base).success).toBe(false);
    expect(enquirySchema.safeParse({ ...base, contactPhone: "+919800000000" }).success).toBe(true);
    expect(enquirySchema.safeParse({ ...base, contactEmail: "a@b.com" }).success).toBe(true);
    // Whitespace is not a phone number.
    expect(enquirySchema.safeParse({ ...base, contactPhone: "   " }).success).toBe(false);
  });

  it("refuses a loss with no reason", () => {
    const note = {
      enquiryId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d11",
      note: "Went elsewhere",
      channel: "phone" as const,
    };
    expect(followUpSchema.safeParse({ ...note, outcome: "lost" }).success).toBe(false);
    expect(
      followUpSchema.safeParse({ ...note, outcome: "lost", lostReason: "Closer school" }).success,
    ).toBe(true);
    expect(followUpSchema.safeParse({ ...note, outcome: "visited" }).success).toBe(true);
  });

  it("takes four characters of an ID and no more", () => {
    const visitor = { visitorName: "Ramesh Iyer", purpose: "Delivery" };
    expect(visitorSchema.safeParse(visitor).success).toBe(true);
    expect(visitorSchema.safeParse({ ...visitor, idProofLast4: "4821" }).success).toBe(true);
    expect(visitorSchema.safeParse({ ...visitor, idProofLast4: "482" }).success).toBe(false);
    expect(visitorSchema.safeParse({ ...visitor, idProofLast4: "1234567890" }).success).toBe(false);
  });

  it("refuses a pass with no reason for the visit", () => {
    expect(visitorSchema.safeParse({ visitorName: "Somebody", purpose: "" }).success).toBe(false);
  });
});
