import { describe, expect, it, vi } from "vitest";
import { serverFetch } from "@/lib/supabase/fetch";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const noWait = () => Promise.resolve();
const URL_ = "https://example.supabase.co/rest/v1/rpc/my_schools";

/**
 * The server client's fetch (src/lib/supabase/fetch.ts). The retry exists
 * because of one logged failure on 26 Oct 2026: `my_schools` refused with
 * PGRST303 a token issued 1.8 seconds earlier, which the next request accepted.
 */
describe("serverFetch", () => {
  it("asks once more when a fresh token is refused with PGRST303, and returns the second answer", async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(json(401, { code: "PGRST303", message: "JWT issued at future" }))
      .mockResolvedValueOnce(json(200, [{ tenant_id: "x" }]));
    const res = await serverFetch("ro", base, noWait)(URL_, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    // The same request, body included, is sent the second time.
    expect(base.mock.calls[1]).toEqual(base.mock.calls[0]);
  });

  it("asks only once more, and passes the second refusal on", async () => {
    const base = vi.fn().mockResolvedValue(json(401, { code: "PGRST303", message: "JWT issued at future" }));
    const res = await serverFetch("ro", base, noWait)(URL_, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("does not retry an expired or invalid token, a permission error or a success", async () => {
    for (const [status, body] of [
      [401, { code: "PGRST301", message: "JWT expired" }],
      [403, { code: "42501", message: "permission denied" }],
      [400, { code: "P0001", message: "a sentence" }],
    ] as const) {
      const base = vi.fn().mockResolvedValue(json(status, body));
      const res = await serverFetch("ro", base, noWait)(URL_, { method: "POST", body: "{}" });
      expect(res.status).toBe(status);
      expect(base, body.code).toHaveBeenCalledTimes(1);
    }
    const ok = vi.fn().mockResolvedValue(json(200, []));
    await serverFetch("ro", ok, noWait)(URL_);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("does not resend a body it cannot read twice", async () => {
    const base = vi.fn().mockResolvedValue(json(401, { code: "PGRST303", message: "x" }));
    const stream = new ReadableStream();
    await serverFetch("ro", base, noWait)(URL_, { method: "POST", body: stream });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("puts the read-only sentence on a write in another year, keeping the code", async () => {
    const base = vi.fn().mockResolvedValue(json(400, { code: "25006", message: "cannot execute UPDATE in a read-only transaction" }));
    const res = await serverFetch("Go back to the current year.", base, noWait)(URL_, { method: "POST", body: "{}" });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "25006", message: "Go back to the current year." });
  });
});
