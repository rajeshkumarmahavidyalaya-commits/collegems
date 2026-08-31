import { describe, expect, it } from "vitest";
import { tenantAClient } from "../helpers/client";

/**
 * CLAUDE.md rule 1 as an executable check: if someone adds a table to
 * `public` without tenant_id or without RLS enabled, this fails.
 *
 * `tenants` is the single documented exception -- it IS the tenant, so it
 * has no tenant_id of its own (its RLS compares `id` instead).
 *
 * Reads the catalog through the `schema_guard` RPC, because information_schema
 * is not exposed over PostgREST.
 */
describe("schema invariants", () => {
  it("every table in public has tenant_id and RLS enabled", async () => {
    const client = await tenantAClient();
    const { data, error } = await client.rpc("schema_guard_violations");

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
