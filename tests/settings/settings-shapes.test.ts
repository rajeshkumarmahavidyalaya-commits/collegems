import { describe, expect, it } from "vitest";
import {
  inputType,
  isFilledIn,
  originSentence,
  parseFields,
  SETTING_TYPES,
  toFormValue,
  toJsonValue,
} from "@/lib/validations/settings";

/**
 * The settings catalogue's client half, without a database.
 *
 * Two of these pin agreements with Postgres rather than preferences.
 * `isFilledIn` has to match `settings_problems()`'s test exactly — including
 * the state both tenants were in, an object with eight keys and every one null.
 * And `toJsonValue("")` has to be **null**: storing an empty string would make
 * the critic call a setting filled in, and a school would stop being warned
 * that its certificates are about to print a blank address.
 */

describe("the type list", () => {
  it("has no secret type, and that is the mechanism", () => {
    // `public.settings` is readable by every tenant member, so a credential
    // here would be published to every family. Provider keys live on the Edge
    // Functions (rule 6). If a setting needs to be secret, it is not a setting.
    expect(SETTING_TYPES).not.toContain("secret");
    expect(SETTING_TYPES).not.toContain("password");
  });

  it("maps every declared type to a real input", () => {
    for (const type of SETTING_TYPES) {
      expect(["text", "number", "email", "url"]).toContain(inputType(type));
    }
  });
});

describe("an empty box means nothing was entered", () => {
  it("stores null rather than an empty string", () => {
    expect(toJsonValue("", "text")).toBeNull();
    expect(toJsonValue("   ", "text")).toBeNull();
    expect(toJsonValue("", "number")).toBeNull();
    expect(toJsonValue("", "email")).toBeNull();
  });

  it("converts to the declared JSON type", () => {
    expect(toJsonValue("5", "number")).toBe(5);
    expect(toJsonValue("2.5", "number")).toBe(2.5);
    expect(toJsonValue("true", "boolean")).toBe(true);
    expect(toJsonValue("false", "boolean")).toBe(false);
    expect(toJsonValue(" Ballia ", "text")).toBe("Ballia");
  });

  it("refuses to store nonsense as a number", () => {
    expect(toJsonValue("five", "number")).toBeNull();
  });

  it("round-trips through the form and back", () => {
    expect(toFormValue(toJsonValue("4", "number"))).toBe("4");
    expect(toFormValue(toJsonValue("", "text"))).toBe("");
    expect(toFormValue(false)).toBe("false");
  });
});

describe("whether a setting counts as filled in", () => {
  it("matches the critic: an object of nulls is not filled in", () => {
    // This is exactly the state `school.profile` was in from the day the
    // certificates module shipped, which is why 0136 had to strip
    // {{school.city}} out of a certificate a school could not otherwise issue.
    expect(
      isFilledIn({
        address_line1: null,
        city: null,
        state: null,
        postal_code: null,
        phone: null,
        email: null,
        website: null,
      }),
    ).toBe(false);
  });

  it("counts one filled field as filled in", () => {
    expect(isFilledIn({ city: "Ballia", state: null })).toBe(true);
  });

  it("does not count whitespace", () => {
    expect(isFilledIn({ city: "   " })).toBe(false);
    expect(isFilledIn("")).toBe(false);
  });

  it("counts false as a value somebody chose", () => {
    // "Online payments: off" is a decision, not an absence.
    expect(isFilledIn(false)).toBe(true);
    expect(isFilledIn(0)).toBe(true);
  });

  it("treats null and undefined as not filled in", () => {
    expect(isFilledIn(null)).toBe(false);
    expect(isFilledIn(undefined)).toBe(false);
  });
});

describe("set, versus left alone", () => {
  it("says which, because one value cannot carry both", () => {
    // "Library fine per day: 2.00" needs to say whether somebody chose 2.00 or
    // whether nobody has ever opened the screen.
    expect(originSentence({ isSet: false, updatedAt: null, updatedBy: null })).toBe(
      "Not set — using the default",
    );
    expect(
      originSentence({ isSet: true, updatedAt: "2026-09-07T15:00:00Z", updatedBy: "Rajesh Kumar" }),
    ).toBe("Changed by Rajesh Kumar on 2026-09-07");
  });

  it("does not claim a person when the writer was a seed", () => {
    expect(
      originSentence({ isSet: true, updatedAt: "2026-09-07T15:00:00Z", updatedBy: "System" }),
    ).toBe("Set on 2026-09-07");
  });
});

describe("parsing the declared fields", () => {
  it("reads what the catalogue declares", () => {
    const fields = parseFields([
      { name: "city", label: "City", type: "text" },
      { name: "email", label: "Email", type: "email" },
    ]);
    expect(fields.map((f) => f.name)).toEqual(["city", "email"]);
    expect(fields[1]!.type).toBe("email");
  });

  it("degrades a type it does not know to text rather than crashing the page", () => {
    const fields = parseFields([{ name: "x", label: "X", type: "quaternion" }]);
    expect(fields[0]!.type).toBe("text");
  });

  it("returns nothing for a shape it cannot read", () => {
    expect(parseFields(null)).toEqual([]);
    expect(parseFields("nonsense")).toEqual([]);
  });
});
