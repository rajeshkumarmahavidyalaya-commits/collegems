import { describe, expect, it } from "vitest";
import {
  hasEndedBefore,
  isCurrentArrangement,
  type DatedArrangement,
} from "@/lib/validations/arrangements";

/**
 * The rule migration `0203` was written to fix, pinned on the surface that came
 * after it.
 *
 * `0203` fixed the phone. `/arrangements` is a second reader of the same
 * history, and rule 12's question — **who else does this?** — is the whole
 * reason this file exists: a fix that lands in one caller has not landed.
 *
 * Deliberately database-free. The guard for a rule that already shipped wrong
 * once must run everywhere, and the DB-backed suites cannot run in every
 * environment.
 */

/** The row that actually went to production, read from the demo school. */
const THE_ROW_THAT_SHIPPED: DatedArrangement = {
  status: "active",
  starts_on: "2025-04-01",
  effective_ends_on: "2026-03-31",
};

describe("a bus seat is current on the date, not on the status column", () => {
  it("does not call a lapsed seat current, however the status column reads", () => {
    // The exact failure: `status: "active"` and `effective_ends_on:
    // "2026-03-31"` in one object, read on 10 September 2026. 88 families were
    // opening an app that said their child had a bus.
    expect(isCurrentArrangement(THE_ROW_THAT_SHIPPED, "2026-09-10")).toBe(false);
    expect(hasEndedBefore(THE_ROW_THAT_SHIPPED, "2026-09-10")).toBe(true);
  });

  it("is inclusive of the last day, because the bill is", () => {
    // Migration 0179 measured this deliberately: 0 of 46 lapsed seats charged
    // today, and all 46 still charged on their own last day. The screen and the
    // invoice must agree about which day that is.
    expect(isCurrentArrangement(THE_ROW_THAT_SHIPPED, "2026-03-31")).toBe(true);
    expect(isCurrentArrangement(THE_ROW_THAT_SHIPPED, "2026-04-01")).toBe(false);
  });

  it("does not call a seat current before it starts", () => {
    // A seat arranged in March for the year beginning in April is a real row,
    // and showing it as today's arrangement would put a child on a bus that is
    // not running yet.
    expect(isCurrentArrangement(THE_ROW_THAT_SHIPPED, "2025-03-31")).toBe(false);
    expect(isCurrentArrangement(THE_ROW_THAT_SHIPPED, "2025-04-01")).toBe(true);
  });

  it("refuses a cancelled row whatever its dates say", () => {
    // Both halves of the predicate are load-bearing. A cancelled seat inside
    // its own dates is not a seat.
    const cancelled = { ...THE_ROW_THAT_SHIPPED, status: "cancelled" };
    expect(isCurrentArrangement(cancelled, "2025-09-01")).toBe(false);
    // ...and it is not "previously" either — it never ran. `hasEndedBefore`
    // reports things that finished, and a cancellation is a different fact.
    // It still has an end date in the past, so it does appear in history; what
    // must never happen is it appearing as current.
    expect(hasEndedBefore(cancelled, "2026-09-10")).toBe(true);
  });

  it("treats a genuinely open end as open", () => {
    // `effective_ends_on` is null only when the row carries no session dates at
    // all. That is the one case where "no end" really means no end — and it is
    // NOT the case rule 2 was about, which was a null `ends_on` on a row that
    // did have a session.
    const openEnded: DatedArrangement = {
      status: "active",
      starts_on: "2025-04-01",
      effective_ends_on: null,
    };
    expect(isCurrentArrangement(openEnded, "2030-01-01")).toBe(true);
    expect(hasEndedBefore(openEnded, "2030-01-01")).toBe(false);
  });

  it("compares dates as strings, so no timezone can move the boundary", () => {
    // ISO YYYY-MM-DD sorts lexicographically, which is why this module builds
    // no Date object. Vercel runs in UTC and the school does not; a boundary
    // that shifts by a day is how a family is billed for a day they were not
    // on the bus.
    const row: DatedArrangement = {
      status: "active",
      starts_on: "2026-01-09",
      effective_ends_on: "2026-01-10",
    };
    expect(isCurrentArrangement(row, "2026-01-10")).toBe(true);
    expect(isCurrentArrangement(row, "2026-01-11")).toBe(false);
    // The naive `new Date(...)` version of this comparison is what would have
    // made 2026-01-10 fall on either side depending on where the server is.
    expect("2026-01-10" >= "2026-01-10").toBe(true);
  });
});
