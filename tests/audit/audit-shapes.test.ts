import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actionTone,
  actorIsPerson,
  AUDIT_ACTIONS,
  EMPTY_VALUE,
  entrySummary,
  fieldLabel,
  formatAuditValue,
  parseChangedFields,
} from "@/lib/validations/audit";

/**
 * The audit trail's client half, without a database.
 *
 * The one that pins an agreement with Postgres is `entrySummary`: migration
 * 0163 excludes `updated_at` from the diff, so an update that touched only that
 * column arrives here as `{}` — and it has to read as a sentence rather than as
 * "0 fields changed", which sends the reader hunting for a change that is not
 * there. Observed in the live log: two no-op touches on `subjects`.
 */

describe("what an entry says", () => {
  it("says an empty update is an empty update", () => {
    expect(entrySummary({ action: "update", fieldCount: 0 })).toBe("Saved with no changes");
  });

  it("counts one field as one", () => {
    expect(entrySummary({ action: "update", fieldCount: 1 })).toBe("1 field changed");
    expect(entrySummary({ action: "update", fieldCount: 4 })).toBe("4 fields changed");
  });

  it("does not count fields for a create or a delete", () => {
    // Every column is "changed" on an insert, which is a number that means
    // nothing. The action is the whole story.
    expect(entrySummary({ action: "insert", fieldCount: 34 })).toBe("Created");
    expect(entrySummary({ action: "delete", fieldCount: 34 })).toBe("Deleted");
  });
});

describe("actions", () => {
  it("is said from the reader's side, not the database's", () => {
    expect(actionLabel("insert")).toBe("Created");
    expect(actionLabel("update")).toBe("Edited");
    expect(actionLabel("delete")).toBe("Deleted");
  });

  it("never relies on colour alone", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(actionLabel(action)).not.toBe(action);
      expect(actionTone(action)).toBeTruthy();
    }
  });

  it("degrades readably for an action it has never seen", () => {
    expect(actionLabel("truncate")).toBe("truncate");
    expect(actionTone("truncate")).toBe("secondary");
  });
});

describe("naming who", () => {
  it("treats the two unanswerables as states, not names", () => {
    // Postgres already distinguishes them (0163): "System" is nobody signed in,
    // "Deleted login" is somebody whose account is gone. Both render differently
    // from a person's name.
    expect(actorIsPerson("System")).toBe(false);
    expect(actorIsPerson("Deleted login")).toBe(false);
    expect(actorIsPerson("Aditi Agarwal")).toBe(true);
  });
});

describe("field labels", () => {
  it("keeps the id suffix, because the value is an id", () => {
    // "Substitute staff: 8f3c…" promises a name and shows a key.
    expect(fieldLabel("substitute_staff_id")).toBe("Substitute staff id");
  });

  it("humanises without inventing", () => {
    expect(fieldLabel("cancel_reason")).toBe("Cancel reason");
    expect(fieldLabel("status")).toBe("Status");
  });
});

describe("rendering a value", () => {
  it("shows an em dash for nothing, and distinguishes it from false", () => {
    expect(formatAuditValue(null)).toBe(EMPTY_VALUE);
    expect(formatAuditValue(undefined)).toBe(EMPTY_VALUE);
    expect(formatAuditValue("")).toBe(EMPTY_VALUE);
    // `false` is a value somebody set, not an absence.
    expect(formatAuditValue(false)).toBe("No");
    expect(formatAuditValue(true)).toBe("Yes");
  });

  it("keeps numbers exact, including zero", () => {
    expect(formatAuditValue(0)).toBe("0");
    expect(formatAuditValue(4200.5)).toBe("4200.5");
  });

  it("truncates a long value rather than breaking the row", () => {
    const long = "x".repeat(200);
    const shown = formatAuditValue(long, 20);
    expect(shown).toHaveLength(20);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("renders a nested object rather than [object Object]", () => {
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("parsing the diff", () => {
  it("reads {field: {from, to}} and sorts it", () => {
    const parsed = parseChangedFields({
      status: { from: "issued", to: "cancelled" },
      cancel_reason: { from: null, to: "Issued in error" },
    });
    expect(parsed.map((c) => c.field)).toEqual(["cancel_reason", "status"]);
    expect(parsed[0]!.from).toBeNull();
    expect(parsed[0]!.to).toBe("Issued in error");
  });

  it("returns nothing rather than throwing on a shape it does not know", () => {
    expect(parseChangedFields(null)).toEqual([]);
    expect(parseChangedFields("nonsense")).toEqual([]);
    expect(parseChangedFields([1, 2, 3])).toEqual([]);
  });

  it("treats an empty diff as an empty list", () => {
    expect(parseChangedFields({})).toEqual([]);
  });
});
