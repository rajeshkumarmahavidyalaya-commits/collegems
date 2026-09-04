import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  audienceToJson,
  channelSends,
  channelState,
  composeSchema,
  templateVariables,
  toAudience,
  type ChannelStatus,
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
  /**
   * This used to assert `CHANNELS.filter(c => c.live)` was exactly `in_app`,
   * which was the whole of rule 10's honesty while nothing had a driver. It is
   * no longer enough: liveness is now a fact about this deployment and this
   * school, and a constant cannot know either. What is pinned instead is the
   * *shape* of the answer -- that a channel with no driver can never claim to
   * send, that a school which has not turned one on is told so, and that the
   * dispatcher having never run is distinguishable from it having run and found
   * nothing.
   */
  const base: ChannelStatus = {
    channel: "email",
    isEnabled: false,
    fromAddress: null,
    senderName: null,
    provider: null,
    providerConfigured: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    queued: 0,
    oldestQueuedAt: null,
    failed: 0,
    sentRecently: 0,
  };

  it("names exactly the channels this build can send", () => {
    expect(CHANNELS.filter((c) => c.driver === "built").map((c) => c.value)).toEqual([
      "in_app",
      "email",
      "sms",
    ]);
  });

  it("never claims a channel with no driver can send, however it is configured", () => {
    for (const channel of ["whatsapp", "push"] as const) {
      const state = channelState({
        ...base,
        channel,
        isEnabled: true,
        fromAddress: "office@school.example",
        providerConfigured: true,
      });
      expect(state.kind, channel).toBe("unbuilt");
      expect(channelSends({ ...base, channel, isEnabled: true, providerConfigured: true })).toBe(
        false,
      );
    }
  });

  it("in-app always sends, because the row is the delivery", () => {
    expect(channelSends({ ...base, channel: "in_app", isEnabled: true })).toBe(true);
  });

  it("tells a school it has the channel switched off, before anything else", () => {
    const state = channelState({ ...base, isEnabled: false, providerConfigured: true });
    expect(state.kind).toBe("held");
    expect(state.sentence).toContain("Turned off");
  });

  it("distinguishes never-run from run-and-unconfigured", () => {
    const neverRun = channelState({ ...base, isEnabled: true, providerConfigured: null });
    expect(neverRun.sentence).toContain("has not run yet");

    const unconfigured = channelState({
      ...base,
      isEnabled: true,
      providerConfigured: false,
      lastError: "No email provider is connected. Set RESEND_API_KEY.",
    });
    expect(unconfigured.kind).toBe("held");
    expect(unconfigured.sentence).toContain("RESEND_API_KEY");
  });

  it("only says a channel sends when all three parts hold", () => {
    const live = {
      ...base,
      isEnabled: true,
      providerConfigured: true,
      provider: "resend",
      fromAddress: "office@school.example",
    };
    expect(channelSends(live)).toBe(true);
    expect(channelState(live).sentence).toContain("resend");
  });

  it("still reports live when the last attempt failed, and says so", () => {
    const state = channelState({
      ...base,
      isEnabled: true,
      providerConfigured: true,
      provider: "resend",
      lastError: "550 sender domain not verified",
    });
    expect(state.kind).toBe("live");
    expect(state.sentence).toContain("550 sender domain not verified");
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
