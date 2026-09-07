import { describe, expect, it } from "vitest";
import { tenantAClient } from "../helpers/client";

/**
 * CLAUDE.md rule 1 as an executable check, in two halves.
 *
 * The first asks whether a table has the right **shape** — tenant_id, RLS on.
 * The second asks whether it has the right **grants**, which is a different
 * question that failed for six months without anybody noticing: a policy gates
 * SELECT, INSERT, UPDATE and DELETE and nothing else, so `TRUNCATE` was
 * reachable on all 184 tables however the policies read. See migration 0159.
 *
 * Reads the catalog through RPCs, because information_schema is not exposed
 * over PostgREST.
 */
describe("schema invariants", () => {
  it("every table in public has tenant_id and RLS enabled", async () => {
    // `tenants` is the single documented exception — it IS the tenant, so it
    // has no tenant_id of its own (its RLS compares `id` instead).
    const client = await tenantAClient();
    const { data, error } = await client.rpc("schema_guard_violations");

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("no signed-in role holds a privilege RLS cannot refuse", async () => {
    // TRUNCATE, TRIGGER, REFERENCES, MAINTAIN. This is the whole test for the
    // hole 0159 closed, and it has to be: a client cannot *emit* a TRUNCATE
    // through PostgREST, so there is no request to send and assert a 403 for.
    // What was wrong was the privilege, so the privilege is what is asserted —
    // and it is asserted through `has_table_privilege`, which follows role
    // membership, rather than through the grant tables, which do not.
    const client = await tenantAClient();
    const { data, error } = await client.rpc("privilege_guard_violations");

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
