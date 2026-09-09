import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  awardConcessionSchema,
  concessionSentence,
  CONCESSION_KINDS,
  createConcessionSchema,
  isLiveOn,
  kindLabel,
  statusLabel,
  statusTone,
} from "@/lib/validations/concessions";

const t = createTranslator("en");

/**
 * Concessions' client half, without a database.
 *
 * The arithmetic lives in Postgres and is pinned in `concession-engine.test.ts`.
 * What is pinned here is the pair of agreements a screen can silently break:
 * `isLiveOn` has to match `fees_concession_lines`'s own liveness test, and
 * `concessionSentence` has to show a ceiling, because *"20%"* on a screen and
 * *"20%, up to 2,000"* in the engine is how a bursar comes to expect a number
 * the system will never credit.
 */

describe("what a concession says it is", () => {
  it("shows the ceiling, not just the percentage", () => {
    expect(concessionSentence({ kind: "percentage", value: 20, maxAmount: 2000 })).toBe(
      "20%, up to 2000",
    );
  });

  it("says a plain percentage plainly", () => {
    expect(concessionSentence({ kind: "percentage", value: 10, maxAmount: null })).toBe("10%");
  });

  it("says a fixed amount without a per-cent sign", () => {
    expect(concessionSentence({ kind: "amount", value: 1000, maxAmount: null })).toBe("1000");
  });

  it("labels every kind the database allows", () => {
    for (const kind of CONCESSION_KINDS) {
      expect(kindLabel(kind, t)).not.toBe(kind);
    }
  });
});

describe("whether an award is doing anything today", () => {
  const base = { status: "active", grantedOn: "2026-04-01", endsOn: null as string | null };

  it("matches the engine: active, started, not ended", () => {
    expect(isLiveOn(base, "2026-09-08")).toBe(true);
  });

  it("is not live before it starts", () => {
    // The engine tests `granted_on <= as_of`; a screen that showed it as live
    // would promise a discount the next invoice will not give.
    expect(isLiveOn(base, "2026-03-31")).toBe(false);
  });

  it("is live on its last day and dead the day after", () => {
    const ending = { ...base, endsOn: "2026-09-08" };
    expect(isLiveOn(ending, "2026-09-08")).toBe(true);
    expect(isLiveOn(ending, "2026-09-09")).toBe(false);
  });

  it("is never live once withdrawn, whatever the dates say", () => {
    expect(isLiveOn({ ...base, status: "revoked" }, "2026-09-08")).toBe(false);
  });
});

describe("status", () => {
  it("says withdrawn rather than revoked, and never relies on colour", () => {
    expect(statusLabel("revoked", t)).toBe("Withdrawn");
    expect(statusLabel("active", t)).toBe("Active");
    expect(statusTone("revoked")).toBe("secondary");
    expect(statusTone("active")).toBe("success");
  });
});

describe("defining one", () => {
  const valid = {
    code: "SIBLING",
    name: "Sibling discount",
    kind: "percentage" as const,
    value: 10,
    maxAmount: null,
    priority: 100,
    feeHeadIds: [],
  };

  it("accepts a percentage with a ceiling", () => {
    const parsed = createConcessionSchema.parse({ ...valid, maxAmount: 2000 });
    expect(parsed.maxAmount).toBe(2000);
  });

  it("refuses a percentage over 100", () => {
    const result = createConcessionSchema.safeParse({ ...valid, value: 120 });
    expect(result.success).toBe(false);
  });

  it("refuses a ceiling on a fixed amount, as the CHECK does", () => {
    // `fee_concessions_max_amount_chk` says the same thing; this just says it
    // before the round trip.
    const result = createConcessionSchema.safeParse({
      ...valid,
      kind: "amount",
      value: 1000,
      maxAmount: 500,
    });
    expect(result.success).toBe(false);
  });

  it("refuses a concession of nothing", () => {
    expect(createConcessionSchema.safeParse({ ...valid, value: 0 }).success).toBe(false);
  });

  it("insists on a code a person can type", () => {
    expect(createConcessionSchema.safeParse({ ...valid, code: "sib ling" }).success).toBe(false);
  });
});

describe("awarding one", () => {
  const valid = {
    studentId: "018fa0dc-cf38-49aa-acf1-eae276485c70",
    concessionId: "2d15d1fc-7e33-4184-bb1d-952e012ca637",
    reason: "Elder brother in Grade 9",
    endsOn: null,
  };

  it("requires a reason", () => {
    // The database requires it too (`student_concessions_reason_chk`), because
    // a discount with no stated cause is the one an auditor asks about.
    expect(awardConcessionSchema.safeParse({ ...valid, reason: "" }).success).toBe(false);
    expect(awardConcessionSchema.safeParse({ ...valid, reason: "  x " }).success).toBe(false);
  });

  it("accepts an open-ended award", () => {
    expect(awardConcessionSchema.parse(valid).endsOn).toBeNull();
  });
});
