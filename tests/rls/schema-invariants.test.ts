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

  it("every table carries an audit trigger, bar the four named exemptions", async () => {
    // Rule 9. Eighty-seven of ninety-three had one and nothing would ever have
    // said so — which is the failure that matters, because an audit log with
    // holes answers "who changed this" with silence, and silence reads as
    // "nobody did". The exemptions are in migration 0162, each a table whose
    // row IS the record and can never be edited.
    const client = await tenantAClient();
    const { data, error } = await client.rpc("audit_guard_violations");

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("no plain index is a strict prefix of another plain index", async () => {
    // Rule 1's fourth guard, added by 0204. `tenant_id` leads every table and
    // every composite index, so `x_tenant_idx ON (tenant_id)` kept being added
    // beside a longer index that already covered it — 87 of them, a third of
    // every plain index in the schema.
    //
    // A btree on (a) is a strict prefix of a btree on (a, b): every seek the
    // short one serves, the long one serves too. So this is not a heuristic
    // about query shapes, and the check needs no workload to be true.
    //
    // What it is NOT is a latency test. Measured both ways in one warm session,
    // inserting 300 register marks was 102.0 ms with the redundant indexes and
    // 105.7 ms without — indistinguishable. The saving is a write per row per
    // index, which is ~nothing at 6,000 rows and real at the 80,000 a school
    // writes each year. Do not "restore" one of these because a screen felt
    // slow; it will not have been this.
    const client = await tenantAClient();
    const { data, error } = await client.rpc("index_guard_violations");

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
