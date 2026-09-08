import { describe, expect, it } from "vitest";
import {
  decisionTone,
  fareChange,
  renewalKindLabel,
  RENEWAL_KINDS,
} from "@/lib/validations/renewals";

/**
 * Carrying arrangements forward, browser half.
 *
 * The one worth care is `fareChange`. A renewal copies a child from last
 * year's stop to this year's, and this year's stop carries this year's fare —
 * so a renewal can raise a family's bill. That is legitimate and it must be
 * *visible*: a screen that showed only the new number could not say a rise had
 * happened, and the first anybody would hear of it is a phone call in May.
 */

describe("fareChange", () => {
  it("says nothing changed when the fare is the same", () => {
    expect(fareChange(1200, 1200)).toBe("same");
  });

  it("names a rise and a fall", () => {
    expect(fareChange(1200, 1350)).toBe("up");
    expect(fareChange(1200, 1100)).toBe("down");
  });

  // A row with no target has no fare, and "no target" must not read as "free".
  it("does not call a missing target a reduction", () => {
    expect(fareChange(1200, null)).toBe("unknown");
    expect(fareChange(1200, null)).not.toBe("down");
  });

  it("treats zero as a real fare rather than a missing one", () => {
    expect(fareChange(1200, 0)).toBe("down");
    expect(fareChange(0, 0)).toBe("same");
  });
});

describe("decisionTone", () => {
  // A refusal outranks the decision: a row that says "carry" and failed is not
  // a row anybody should read as done.
  it("shows a refusal as a refusal whatever the row decided", () => {
    expect(decisionTone("renew", "Route R1 is not running")).toBe("destructive");
    expect(decisionTone("skip", "Route R1 is not running")).toBe("destructive");
  });

  it("separates carrying from skipping when nothing failed", () => {
    expect(decisionTone("renew", null)).toBe("default");
    expect(decisionTone("skip", null)).toBe("secondary");
  });
});

describe("kinds", () => {
  // The list is the contract with `renewal_start_run`, which refuses anything
  // else by name. A third kind added here without a migration would offer a
  // button that can only fail.
  it("offers exactly the two the database accepts", () => {
    expect(RENEWAL_KINDS.map((k) => k.value)).toEqual(["transport", "hostel"]);
  });

  it("labels a kind in words, and leaves an unknown one alone", () => {
    expect(renewalKindLabel("transport")).toBe("Bus seats");
    expect(renewalKindLabel("hostel")).toBe("Hostel beds");
    expect(renewalKindLabel("concession")).toBe("concession");
  });

  it("gives every kind a sentence, because the button needs one", () => {
    for (const kind of RENEWAL_KINDS) {
      expect(kind.blurb.length).toBeGreaterThan(20);
    }
  });
});
