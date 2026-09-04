import { describe, expect, it } from "vitest";
import {
  allocationSchema,
  bedsSentence,
  genderAllowed,
  hostelKindLabel,
  hostelSchema,
  HOSTEL_KINDS,
  isCurrent,
  occupancyTone,
  roomSchema,
} from "@/lib/validations/hostel";

/**
 * Dormitory, browser half.
 *
 * The gender table is the one worth care: it is duplicated between
 * `genderAllowed` here and the check inside `hostel_allocate`, and the two
 * disagreeing would either let somebody submit a placement that can only be
 * refused, or block one the database would have accepted.
 */

describe("genderAllowed", () => {
  const table: Record<string, { male: boolean; female: boolean }> = {
    boys: { male: true, female: false },
    girls: { male: false, female: true },
    mixed: { male: true, female: true },
  };

  for (const [kind, expected] of Object.entries(table)) {
    it(`a ${kind} house takes male=${expected.male}, female=${expected.female}`, () => {
      expect(genderAllowed(kind, "male")).toBe(expected.male);
      expect(genderAllowed(kind, "female")).toBe(expected.female);
    });
  }

  // The part that is easy to get wrong. The office places children before the
  // admission form comes back; refusing them would push the work onto paper,
  // and `hostel_allocate` deliberately lets these through too.
  it("does not refuse a child whose gender is not recorded", () => {
    for (const kind of HOSTEL_KINDS.map((k) => k.value)) {
      expect(genderAllowed(kind, null)).toBe(true);
      expect(genderAllowed(kind, undefined)).toBe(true);
      expect(genderAllowed(kind, "other")).toBe(true);
      expect(genderAllowed(kind, "undisclosed")).toBe(true);
    }
  });

  it("labels a kind in words", () => {
    expect(hostelKindLabel("boys")).toBe("Boys");
    expect(hostelKindLabel("nonsense")).toBe("nonsense");
  });
});

describe("bedsSentence", () => {
  it("counts down from the bed count", () => {
    expect(bedsSentence(4, 1)).toBe("3 of 4 free");
    expect(bedsSentence(2, 1)).toBe("1 of 2 free");
  });

  it("says full rather than zero free", () => {
    expect(bedsSentence(4, 4)).toBe("Full — 4 of 4");
  });

  // Reachable by lowering a room's bed count under its occupants, which is
  // allowed and deliberately visible rather than refused.
  it("reads as full, not negative, when a room is over its capacity", () => {
    expect(bedsSentence(4, 5)).toBe("Full — 5 of 4");
    expect(occupancyTone(4, 5)).toBe("full");
  });

  it("warns before it is full", () => {
    expect(occupancyTone(4, 1)).toBe("ok");
    expect(occupancyTone(4, 3)).toBe("warn");
    expect(occupancyTone(4, 4)).toBe("full");
  });
});

describe("isCurrent", () => {
  const today = "2026-09-04";

  it("counts an open-ended stay as running", () => {
    expect(isCurrent({ status: "active", startsOn: "2026-04-01", endsOn: null }, today)).toBe(true);
  });

  it("excludes ended, future and cancelled stays", () => {
    expect(isCurrent({ status: "active", startsOn: "2026-04-01", endsOn: "2026-08-31" }, today)).toBe(false);
    expect(isCurrent({ status: "active", startsOn: "2026-10-01", endsOn: null }, today)).toBe(false);
    expect(isCurrent({ status: "cancelled", startsOn: "2026-04-01", endsOn: null }, today)).toBe(false);
  });
});

describe("form shapes", () => {
  it("allows a house with no warden and no fee head", () => {
    expect(
      hostelSchema.safeParse({ name: "Tagore House", kind: "boys", isActive: true }).success,
    ).toBe(true);
  });

  it("requires at least one bed, in whole numbers", () => {
    const base = { roomNumber: "A-101", monthlyFare: 3200, isActive: true };
    expect(roomSchema.safeParse({ ...base, beds: 4 }).success).toBe(true);
    expect(roomSchema.safeParse({ ...base, beds: 0 }).success).toBe(false);
    expect(roomSchema.safeParse({ ...base, beds: 2.5 }).success).toBe(false);
  });

  it("allows a free room but not a negative fare", () => {
    const base = { roomNumber: "A-101", beds: 4, isActive: true };
    expect(roomSchema.safeParse({ ...base, monthlyFare: 0 }).success).toBe(true);
    expect(roomSchema.safeParse({ ...base, monthlyFare: -1 }).success).toBe(false);
  });

  it("refuses a stay that ends before it starts", () => {
    const base = {
      studentId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d11",
      roomId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d12",
    };
    expect(allocationSchema.safeParse({ ...base, startsOn: "2026-07-01", endsOn: "2026-06-01" }).success).toBe(false);
    expect(allocationSchema.safeParse({ ...base, startsOn: "2026-07-01" }).success).toBe(true);
  });
});
