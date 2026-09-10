import { describe, expect, it } from "vitest";
import { tenantAClient } from "../helpers/client";
import { SLUG_PATTERN, slugify } from "@/lib/validations/platform";

/**
 * The SaaS boundary.
 *
 * Two halves, and only one of them needs a database. The slug rules are pure
 * and are asserted directly; the authorisation is a claim about what a signed-in
 * person can do to a *different* school, so it is probed as that person.
 */
describe("a slug is a permanent public address", () => {
  it("accepts what the SQL accepts and rejects what it rejects", () => {
    // Deliberately the same expression `platform_start_school` enforces. Two
    // copies of a rule is a thing this codebase throws out on sight -- but here
    // the server is the gate and this exists only so a person is told before
    // they submit, which is the "client is a convenience" split.
    for (const good of ["st-aloysius", "abc", "k12-delhi-2", "a1b"]) {
      expect(SLUG_PATTERN.test(good), `${good} should be allowed`).toBe(true);
    }
    for (const bad of ["ab", "-leading", "trailing-", "Upper", "has space", "under_score", ""]) {
      expect(SLUG_PATTERN.test(bad), `${bad} should be refused`).toBe(false);
    }
  });

  it("suggests an address from a school's name without ever ending in a hyphen", () => {
    expect(slugify("St Aloysius High School")).toBe("st-aloysius-high-school");
    expect(slugify("  Rajesh Kumar   Mahavidyalaya  ")).toBe("rajesh-kumar-mahavidyalaya");
    // The one that bites: punctuation at the end used to leave a trailing
    // hyphen, which the pattern above refuses -- so the suggestion would have
    // been rejected by the form that produced it.
    expect(slugify("Little Flower's School!")).toBe("little-flowers-school");
    expect(slugify("A".repeat(80))).not.toMatch(/-$/);
  });
});

describe("who may start a school", () => {
  it("refuses somebody who already belongs to one", async () => {
    // The whole authorisation is `current_tenant_id() is not null`, so this is
    // the test of it. A member of tenant A asking for a new tenant must be
    // refused -- otherwise one login could farm schools.
    const client = await tenantAClient();
    const { error } = await client.rpc("platform_start_school", {
      p_school_name: "Should Never Exist",
      p_slug: "should-never-exist",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already belongs to a school/i);
  });

  it("does not let a member rewrite their own subscription", async () => {
    // `subscriptions` has a SELECT policy and deliberately no write policy at
    // all. An UPDATE that matches no policy SUCCEEDS while touching nothing, so
    // asserting "no error" would pass whatever the policy said -- assert the
    // count, per rule 6.
    const client = await tenantAClient();

    const before = await client.from("subscriptions").select("plan_code").maybeSingle();
    expect(before.error).toBeNull();

    const { data: touched } = await client
      .from("subscriptions")
      .update({ plan_code: "trial" })
      .neq("plan_code", "__none__")
      .select("id");

    expect(touched ?? []).toEqual([]);

    const after = await client.from("subscriptions").select("plan_code").maybeSingle();
    expect(after.data?.plan_code).toBe(before.data?.plan_code);
  });

  it("shows a member their own school's subscription and no other", async () => {
    // Rule 1, on the newest table in the schema. The demo project holds two
    // tenants, so "1" here is the isolation and "2" would be the bug.
    const client = await tenantAClient();
    const { data, error } = await client.from("subscriptions").select("tenant_id");

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("reads the plan catalogue through a function, because the schema is not exposed", async () => {
    // Two independent things stop a client rewriting the price list, and it is
    // worth being precise about which one does the work.
    //
    // The GRANT is the boundary: `reference.plans` has RLS off and INSERT,
    // UPDATE and DELETE revoked from anon and authenticated, exactly like
    // `reference.permissions`. Probed in SQL as `authenticated`, a write raises
    // `42501 permission denied` -- so a caller who somehow reached the table
    // still cannot change it.
    //
    // But a *PostgREST* client cannot reach it at all: `reference` is not an
    // exposed schema, which is why every catalogue in it is read through a
    // function (`report_list`, and now `subscription_overview`). That is also
    // why this test cannot be written as `.schema("reference").from("plans")` --
    // the generated types have no such relation, and TypeScript says so.
    //
    // So the assertion is the reachable path: the catalogue arrives, as data,
    // through the one function that serves it.
    const client = await tenantAClient();
    const { data, error } = await client.rpc("subscription_overview");

    expect(error).toBeNull();
    const overview = data as { available?: { code: string }[] } | null;
    expect(Array.isArray(overview?.available)).toBe(true);
    expect((overview?.available ?? []).length).toBeGreaterThan(0);
  });
});
