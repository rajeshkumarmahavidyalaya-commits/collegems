/**
 * The `fetch` the server's Supabase client uses. Two jobs, both about how a
 * PostgREST answer reaches a person:
 *
 * 1. **A freshly issued token refused once is asked again, once.** On 26 Oct
 *    2026 `/schools` failed for an administrator because `my_schools` came back
 *    401 with `PGRST303` (the token's time claims failed validation). The token
 *    had been issued 1.8 seconds earlier by the middleware's refresh, was valid
 *    for an hour, and was accepted by `my_school_figures` in the same
 *    millisecond; the same page loaded fifty seconds later. A gateway's clock
 *    a moment behind the auth server's is the likely reading. One refused read
 *    took the whole page to the error screen.
 *
 *    The retry is safe for writes too: PostgREST validates the token before it
 *    opens a transaction, so a request refused this way ran no SQL. Only
 *    PGRST303 is retried. An expired or forged token (`PGRST301`), a missing
 *    permission, or any other error is passed on as it came.
 *
 * 2. **A write in a year that is not the working year** is refused by Postgres
 *    with 25006 ("cannot execute UPDATE in a read-only transaction", 0355).
 *    Every screen shows `error.message`, so the sentence is put there once,
 *    here, rather than in each of a hundred server actions.
 */

/** How long to wait before asking again. Long enough for a second of clock skew to pass. */
export const TOKEN_RETRY_DELAY_MS = 1500;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function errorCode(res: Response): Promise<string | null> {
  if (!(res.headers.get("content-type") ?? "").includes("json")) return null;
  try {
    const body = JSON.parse(await res.clone().text());
    return body && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

export function serverFetch(
  readOnlyMessage: string,
  base: Fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Fetch {
  return async (input, init) => {
    let res = await base(input, init);
    if (res.status < 400) return res;

    let code = await errorCode(res);
    // A request whose body is a stream cannot be sent twice; supabase-js sends
    // strings, so in practice every request qualifies.
    const resendable = init?.body == null || typeof init.body === "string";
    if (res.status === 401 && code === "PGRST303" && resendable) {
      await wait(TOKEN_RETRY_DELAY_MS);
      res = await base(input, init);
      if (res.status < 400) return res;
      code = await errorCode(res);
    }

    if (code === "25006") {
      const body = JSON.parse(await res.clone().text());
      return new Response(JSON.stringify({ ...body, message: readOnlyMessage }), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
    return res;
  };
}
