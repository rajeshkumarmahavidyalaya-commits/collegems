import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  audienceToJson,
  composeSchema,
  templateVariables,
  toAudience,
  type ComposeInput,
} from "@/lib/validations/notifications";

/**
 * The parts of the notification service that are pure functions, tested without
 * a database — the translation between the flat form, the discriminated union,
 * and the JSON `notify_send` actually receives.
 *
 * This boundary is worth its own test because it is where a silent failure
 * lives: `{"kind":"section","sectionId":...}` is valid JSON that
 * `notify_resolve_audience` reads as "no section", which resolves to nobody
 * rather than erroring. A camelCase key that should have been snake_case would
 * not throw anywhere — it would just quietly send to no one.
 */

const base: ComposeInput = {
  eventKey: "general.announcement",
  subject: "Sports day",
  body: "Sports day has moved.",
  channels: ["in_app"],
  audienceKind: "all",
  role: "",
  sectionId: "",
  who: "both",
  userIds: [],
};

describe("audience translation", () => {
  it("sends snake_case keys to Postgres, not the form's camelCase", () => {
    const section = audienceToJson(
      toAudience({
        ...base,
        audienceKind: "section",
        sectionId: "6f1b6d1e-58f4-4a1e-8f5a-2f0b7f3c9a11",
        who: "parents",
      }),
    );

    expect(section).toEqual({
      kind: "section",
      section_id: "6f1b6d1e-58f4-4a1e-8f5a-2f0b7f3c9a11",
      who: "parents",
    });
    expect(section).not.toHaveProperty("sectionId");
  });

  it("names the user list `user_ids`, which is the key the RPC reads", () => {
    const users = audienceToJson(
      toAudience({
        ...base,
        audienceKind: "users",
        userIds: ["11111111-1111-4111-8111-111111111111"],
      }),
    );

    expect(users).toEqual({
      kind: "users",
      user_ids: ["11111111-1111-4111-8111-111111111111"],
    });
  });

  it("drops the unused dependent fields rather than sending empty strings", () => {
    // `notify_resolve_audience` reads `p_audience ->> 'role'` for a role
    // audience only, but an empty `section_id` would still be cast to uuid if
    // it were present in a later branch. Not sending it is the safe shape.
    const all = audienceToJson(toAudience({ ...base, audienceKind: "all", role: "teacher" }));
    expect(all).toEqual({ kind: "all" });
  });
});

describe("compose validation", () => {
  it("accepts a well-formed announcement to everyone", () => {
    expect(composeSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a class audience with no class chosen, on the class field", () => {
    const result = composeSchema.safeParse({ ...base, audienceKind: "section" });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.sectionId).toBeDefined();
  });

  it("rejects a named-people audience with nobody named", () => {
    const result = composeSchema.safeParse({ ...base, audienceKind: "users", userIds: [] });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.userIds).toBeDefined();
  });

  it("rejects an empty body — a notification with nothing to say is a bug upstream", () => {
    const result = composeSchema.safeParse({ ...base, body: "" });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.body).toBeDefined();
  });

  it("requires at least one channel", () => {
    const result = composeSchema.safeParse({ ...base, channels: [] });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.channels).toBeDefined();
  });

  it("refuses a channel Postgres would refuse", () => {
    // The channel check constraint and this enum have to agree; a channel that
    // passed here and failed there would be a 500 on submit.
    const result = composeSchema.safeParse({ ...base, channels: ["carrier_pigeon"] });
    expect(result.success).toBe(false);
  });
});

describe("channel honesty", () => {
  it("marks exactly one channel as actually delivering", () => {
    // If a driver is ever connected, this test should fail and be updated
    // deliberately -- the UI's "queues only" wording is derived from this flag,
    // so it must not drift from reality by accident.
    expect(CHANNELS.filter((c) => c.live).map((c) => c.value)).toEqual(["in_app"]);
  });
});

describe("template variables", () => {
  it("finds each placeholder once, in first-use order", () => {
    expect(templateVariables("Hi {{name}}, {{name}} owes {{amount}}")).toEqual(["name", "amount"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(templateVariables("Due {{ due_date }}")).toEqual(["due_date"]);
  });

  it("ignores a single brace, which is not a placeholder", () => {
    expect(templateVariables("Set {x} to 1")).toEqual([]);
  });

  it("returns nothing for text with no placeholders", () => {
    expect(templateVariables("School reopens Monday.")).toEqual([]);
  });
});
