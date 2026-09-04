import { describe, expect, it } from "vitest";
import {
  allowedDirections,
  assignmentSchema,
  DIRECTIONS,
  directionAllowed,
  directionLabel,
  formatFare,
  formatStopTime,
  isCurrent,
  occupancyTone,
  routeSchema,
  seatsSentence,
  stopSchema,
  vehicleSchema,
} from "@/lib/validations/transport";

/**
 * Transport's pure half.
 *
 * Everything that decides whether an assignment is *allowed* lives in Postgres,
 * because every one of those rules is a fact about other rows: a full bus, a
 * child already on another route, a stop belonging to a different route. What
 * is here is the browser's half — the shape a form can catch, and the sentences
 * a screen reads out.
 *
 * The direction table is the exception worth care: it is duplicated between
 * `directionAllowed` here and a CHECK constraint in migration 0084, and the two
 * disagreeing would let somebody fill in a form that can only ever be refused.
 * So it is pinned to the same truth table the constraint implements.
 */

describe("direction compatibility", () => {
  // route -> what it may carry. Same table as
  // `transport_assignments_direction_chk`: route_direction = 'both'
  // or direction = route_direction.
  const table: Record<string, { allowed: string[]; refused: string[] }> = {
    both: { allowed: ["both", "pickup", "drop"], refused: [] },
    pickup: { allowed: ["pickup"], refused: ["both", "drop"] },
    drop: { allowed: ["drop"], refused: ["both", "pickup"] },
  };

  for (const [route, { allowed, refused }] of Object.entries(table)) {
    it(`a ${route} route carries ${allowed.join(", ") || "nothing extra"}`, () => {
      for (const d of allowed) expect(directionAllowed(route, d)).toBe(true);
      for (const d of refused) expect(directionAllowed(route, d)).toBe(false);
    });
  }

  it("offers a form only the directions the route can honour", () => {
    expect(allowedDirections("both").map((d) => d.value)).toEqual(["both", "pickup", "drop"]);
    expect(allowedDirections("pickup").map((d) => d.value)).toEqual(["pickup"]);
    expect(allowedDirections("drop").map((d) => d.value)).toEqual(["drop"]);
  });

  it("never offers an empty list, which would be an unusable form", () => {
    for (const d of DIRECTIONS) {
      expect(allowedDirections(d.value).length).toBeGreaterThan(0);
    }
  });
});

describe("seatsSentence", () => {
  it("counts down from the licensed capacity", () => {
    expect(seatsSentence(40, 20)).toBe("20 of 40 free");
    expect(seatsSentence(40, 39)).toBe("1 of 40 free");
  });

  it("says full rather than showing zero free", () => {
    expect(seatsSentence(26, 26)).toBe("Full — 26 of 26");
  });

  // The distinction that matters: a route with no bus is not a full bus.
  it("does not confuse no vehicle with no room", () => {
    expect(seatsSentence(null, 12)).toBe("No vehicle assigned");
    expect(occupancyTone(null, 12)).toBe("muted");
    expect(occupancyTone(26, 26)).toBe("full");
    expect(occupancyTone(40, 20)).toBe("ok");
    expect(occupancyTone(40, 37)).toBe("warn");
  });

  // Over-assignment should still read as full rather than as negative seats;
  // it can happen if a vehicle's capacity is lowered under a live route.
  it("reads as full when a bus is over its capacity", () => {
    expect(seatsSentence(20, 24)).toBe("Full — 24 of 20");
    expect(occupancyTone(20, 24)).toBe("full");
  });
});

describe("formatting", () => {
  it("prints a fare as money", () => {
    expect(formatFare(1500)).toBe("₹1,500.00");
    expect(formatFare("900.00")).toBe("₹900.00");
    expect(formatFare(null)).toBe("—");
  });

  it("drops the seconds a timetable does not need", () => {
    expect(formatStopTime("07:05:00")).toBe("07:05");
    expect(formatStopTime(null)).toBe("—");
  });

  it("labels a direction in words", () => {
    expect(directionLabel("both")).toBe("Both ways");
    expect(directionLabel("pickup")).toBe("Pickup only");
    expect(directionLabel("nonsense")).toBe("nonsense");
  });
});

describe("isCurrent", () => {
  const today = "2026-09-03";

  it("counts an open-ended arrangement as running", () => {
    expect(isCurrent({ status: "active", startsOn: "2026-07-01", endsOn: null }, today)).toBe(true);
  });

  it("counts the last day itself as running", () => {
    expect(isCurrent({ status: "active", startsOn: "2026-07-01", endsOn: today }, today)).toBe(true);
  });

  it("excludes one that has ended, one not started, and one cancelled", () => {
    expect(isCurrent({ status: "active", startsOn: "2026-07-01", endsOn: "2026-08-31" }, today)).toBe(
      false,
    );
    expect(isCurrent({ status: "active", startsOn: "2026-10-01", endsOn: null }, today)).toBe(false);
    expect(isCurrent({ status: "cancelled", startsOn: "2026-07-01", endsOn: null }, today)).toBe(
      false,
    );
  });
});

describe("form shapes", () => {
  it("requires a vehicle to seat at least one and at most a bus", () => {
    expect(vehicleSchema.safeParse({ registrationNumber: "RJ-14-AB-1234", capacity: 40, isActive: true }).success).toBe(true);
    expect(vehicleSchema.safeParse({ registrationNumber: "RJ-14-AB-1234", capacity: 0, isActive: true }).success).toBe(false);
    expect(vehicleSchema.safeParse({ registrationNumber: "RJ-14-AB-1234", capacity: 4.5, isActive: true }).success).toBe(false);
  });

  it("allows a route with no vehicle and no fee head", () => {
    const result = routeSchema.safeParse({
      code: "R3",
      name: "Village loop",
      direction: "both",
      vehicleId: "",
      feeHeadId: "",
      isActive: true,
    });
    expect(result.success).toBe(true);
  });

  it("allows a free stop but not a negative fare", () => {
    expect(stopSchema.safeParse({ name: "Gate", sequence: 1, monthlyFare: 0 }).success).toBe(true);
    expect(stopSchema.safeParse({ name: "Gate", sequence: 1, monthlyFare: -1 }).success).toBe(false);
    expect(stopSchema.safeParse({ name: "Gate", sequence: 0, monthlyFare: 100 }).success).toBe(false);
  });

  it("refuses an arrangement that ends before it starts", () => {
    const base = {
      studentId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d11",
      stopId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d12",
      direction: "both" as const,
    };
    expect(assignmentSchema.safeParse({ ...base, startsOn: "2026-07-01", endsOn: "2026-06-01" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...base, startsOn: "2026-07-01", endsOn: "2026-07-01" }).success).toBe(true);
    // Open-ended is the normal case: nobody types a leaving date in July.
    expect(assignmentSchema.safeParse({ ...base, startsOn: "2026-07-01" }).success).toBe(true);
  });
});
