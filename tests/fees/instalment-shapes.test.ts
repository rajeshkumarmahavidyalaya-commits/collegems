import { describe, expect, it } from "vitest";
import {
  collectsSentence,
  FEE_FREQUENCIES,
  frequencyLabel,
  instalmentSchema,
  uncollectedFrequencies,
} from "@/lib/validations/fees";

/**
 * Billing periods, browser half.
 *
 * The defect this fixes was not a wrong number — it was a missing concept.
 * `fee_structures.frequency` was stored and displayed and never acted on, so an
 * invoice run charged every head every time, and a school billing monthly
 * charged its annual tuition twelve times. Nothing in the database objected,
 * because nothing knew which period an invoice was for.
 *
 * Two things are pinned here. First, the vocabulary: a period's `collects` and
 * a fee's `frequency` must be the same list, or a school can configure a period
 * that collects something no fee ever is. Second, the warning — a calendar that
 * never collects a frequency somebody actually uses is a silent non-charge, and
 * a school finds out in March.
 */

describe("the frequency vocabulary", () => {
  it("is exactly what fee_structures.frequency can hold", () => {
    // Same four values as the CHECK on fee_structures and the CHECK on
    // fee_instalments.collects. Adding one to the database without adding it
    // here gives a period that cannot be configured to collect it.
    expect(FEE_FREQUENCIES.map((f) => f.value)).toEqual([
      "one_time",
      "monthly",
      "quarterly",
      "annual",
    ]);
  });

  it("labels a frequency, and leaves an unknown one alone", () => {
    expect(frequencyLabel("one_time")).toBe("One time");
    expect(frequencyLabel("fortnightly")).toBe("fortnightly");
  });
});

describe("collectsSentence", () => {
  it("reads out one, two and several", () => {
    expect(collectsSentence(["monthly"])).toBe("Monthly");
    expect(collectsSentence(["monthly", "annual"])).toBe("Monthly and annual");
    expect(collectsSentence(["one_time", "monthly", "annual"])).toBe(
      "One time, Monthly and annual",
    );
  });

  // Declaration order, not array order: the same period must read the same way
  // whichever order Postgres hands the array back in.
  it("does not depend on the order the array arrives in", () => {
    expect(collectsSentence(["annual", "monthly"])).toBe(collectsSentence(["monthly", "annual"]));
  });

  it("says Nothing rather than an empty string", () => {
    expect(collectsSentence([])).toBe("Nothing");
  });
});

describe("uncollectedFrequencies", () => {
  const monthlyOnly = [
    { collects: ["monthly"], isActive: true },
    { collects: ["monthly"], isActive: true },
  ];

  // The exact failure this warns about: twelve monthly periods, an annual
  // tuition, and nobody notices until the year is over.
  it("names a fee frequency no period collects", () => {
    expect(uncollectedFrequencies(monthlyOnly, ["monthly", "annual"])).toEqual(["annual"]);
  });

  it("is quiet when an opening period collects the rest", () => {
    const withOpening = [
      { collects: ["monthly", "annual", "one_time"], isActive: true },
      ...monthlyOnly,
    ];
    expect(uncollectedFrequencies(withOpening, ["monthly", "annual", "one_time"])).toEqual([]);
  });

  // A closed period collects nothing, so it cannot be what covers a frequency.
  it("ignores closed periods", () => {
    const closedOpening = [
      { collects: ["annual"], isActive: false },
      ...monthlyOnly,
    ];
    expect(uncollectedFrequencies(closedOpening, ["annual"])).toEqual(["annual"]);
  });

  it("says nothing when no fee uses a frequency", () => {
    expect(uncollectedFrequencies(monthlyOnly, ["monthly"])).toEqual([]);
  });
});

describe("instalmentSchema", () => {
  const base = {
    name: "July 2026",
    sequence: 4,
    dueDate: "2026-07-10",
    collects: ["monthly"] as const,
    isActive: true,
  };

  it("accepts a period with no covering window", () => {
    expect(instalmentSchema.safeParse(base).success).toBe(true);
  });

  // A period collecting nothing bills nobody, which is a mistake rather than a
  // setting — the same CHECK exists in the database.
  it("refuses a period that collects nothing", () => {
    expect(instalmentSchema.safeParse({ ...base, collects: [] }).success).toBe(false);
  });

  it("refuses a window that ends before it starts", () => {
    expect(
      instalmentSchema.safeParse({
        ...base,
        periodStart: "2026-07-01",
        periodEnd: "2026-06-30",
      }).success,
    ).toBe(false);
    expect(
      instalmentSchema.safeParse({
        ...base,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }).success,
    ).toBe(true);
  });

  it("refuses a position below one", () => {
    expect(instalmentSchema.safeParse({ ...base, sequence: 0 }).success).toBe(false);
  });
});
