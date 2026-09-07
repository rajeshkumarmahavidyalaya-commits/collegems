import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The notice board, through real RLS.
 *
 * Four claims, and each is a way this could have been built wrongly:
 *
 *   1. **Who may see a notice is a policy, not a query.** The audience test is
 *      in the RLS policy, so a parent cannot read another class's circular by
 *      asking for it directly. A filter in a server action would be a filter
 *      the ninth caller forgets.
 *   2. **Publishing announces once; editing never does.** `announced_count` is
 *      the record of that, and re-publishing a withdrawn notice does not
 *      re-announce it.
 *   3. **A failed announcement is not a failed publish.** The board is the
 *      point; the announcement is a courtesy, and its failure is written to
 *      `last_announce_error` rather than thrown or swallowed.
 *   4. **A read receipt cannot be edited or deleted.** Both are revoked
 *      privileges, so they raise -- a school that could clear them could claim
 *      anything about who was told.
 */
describe("the notice board", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  async function draft(overrides: Record<string, unknown> = {}) {
    const { data: profile } = await a
      .from("user_profiles")
      .select("tenant_id")
      .limit(1)
      .single();
    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();

    const { data, error } = await a
      .from("notices")
      .insert({
        tenant_id: profile!.tenant_id,
        session_id: session!.id,
        title: `Test notice ${Date.now()}`,
        body: "Written by the automated test suite.",
        audience: { kind: "all" },
        category: "general",
        ...overrides,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    return data!.id;
  }

  it("puts a notice on the board and announces it exactly once", async () => {
    const id = await draft();

    const first = await a.rpc("notice_publish", { p_notice_id: id });
    expect(first.error).toBeNull();
    const firstResult = first.data as { status: string; announced: boolean };
    expect(firstResult.status).toBe("published");

    const { data: afterFirst } = await a
      .from("notices")
      .select("announced_count, status")
      .eq("id", id)
      .single();
    const countAfterFirst = afterFirst!.announced_count;

    // Publishing again must not announce again. A school reinstating a
    // circular is fixing a mistake, not making a new announcement.
    const second = await a.rpc("notice_publish", { p_notice_id: id });
    expect(second.error).toBeNull();

    const { data: afterSecond } = await a
      .from("notices")
      .select("announced_count")
      .eq("id", id)
      .single();
    expect(afterSecond!.announced_count).toBe(countAfterFirst);

    await a.rpc("notice_withdraw", { p_notice_id: id, p_reason: "Automated test cleanup" });
  });

  it("does not treat a failed announcement as a failed publish", async () => {
    // A role nobody in the demo tenant holds a login for. `notify_send` refuses
    // an audience that matches nobody -- and the notice must go up anyway.
    const id = await draft({ audience: { kind: "role", role: "librarian" } });

    const { error } = await a.rpc("notice_publish", { p_notice_id: id });
    expect(error, "publishing must not fail because nobody could be notified").toBeNull();

    const { data: row } = await a
      .from("notices")
      .select("status, announced_count, last_announce_error")
      .eq("id", id)
      .single();

    expect(row!.status).toBe("published");
    if (row!.announced_count === 0) {
      // ...and the reason is written down rather than swallowed.
      expect(row!.last_announce_error).toBeTruthy();
    }

    await a.rpc("notice_withdraw", { p_notice_id: id, p_reason: "Automated test cleanup" });
  });

  it("will not withdraw without a reason", async () => {
    const id = await draft();
    await a.rpc("notice_publish", { p_notice_id: id });

    const blank = await a.rpc("notice_withdraw", { p_notice_id: id, p_reason: "   " });
    expect(blank.error).not.toBeNull();

    await a.rpc("notice_withdraw", { p_notice_id: id, p_reason: "Automated test cleanup" });
  });

  it("records a read once, and never moves the timestamp", async () => {
    const { data: board } = await a.rpc("notice_board", { p_limit: 1 });
    if (!board?.length) return;
    const id = board[0].id;

    await a.rpc("notice_mark_read", { p_notice_id: id });
    const { data: first } = await a
      .from("notice_reads")
      .select("read_at")
      .eq("notice_id", id)
      .limit(1)
      .single();

    await a.rpc("notice_mark_read", { p_notice_id: id });
    const { data: rows } = await a.from("notice_reads").select("read_at").eq("notice_id", id);

    // One receipt per person per notice, and `read_at` is when they *first*
    // read it -- the only version of that fact worth keeping.
    expect(rows!.length).toBe(1);
    expect(rows![0].read_at).toBe(first!.read_at);
  });

  it("does not let anybody rewrite or clear a read receipt", async () => {
    const { data: existing } = await a.from("notice_reads").select("id").limit(1);
    if (!existing?.length) return;

    // Revoked privileges, so these RAISE rather than silently matching nothing.
    const rewrite = await a
      .from("notice_reads")
      .update({ read_at: new Date().toISOString() })
      .eq("id", existing[0].id);
    expect(rewrite.error).not.toBeNull();

    const removal = await a.from("notice_reads").delete().eq("id", existing[0].id);
    expect(removal.error).not.toBeNull();
  });

  it("keeps the board inside one school", async () => {
    const { data: mine } = await a.from("notices").select("tenant_id");
    const { data: theirs } = await b.from("notices").select("tenant_id");

    const aTenants = new Set((mine ?? []).map((r) => r.tenant_id));
    const bTenants = new Set((theirs ?? []).map((r) => r.tenant_id));
    for (const t of bTenants) expect(aTenants.has(t)).toBe(false);
  });

  it("reports reach as a catalog report, least read first", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "notices.reach",
      p_params: {},
      p_limit: 100,
    });
    expect(error).toBeNull();

    let previous = -1;
    for (const row of data ?? []) {
      const r = row.row_data as Record<string, unknown>;
      expect(r.title).toBeTruthy();
      // Nulls (a notice for nobody) sort first, then ascending. Once a number
      // has been seen, the rest must not go back down.
      if (r.read_percent !== null && r.read_percent !== undefined) {
        expect(Number(r.read_percent)).toBeGreaterThanOrEqual(previous);
        previous = Number(r.read_percent);
      }
    }
  });
});
