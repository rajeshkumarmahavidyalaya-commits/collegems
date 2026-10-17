import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { READ_ONLY_YEAR_MESSAGE, YEAR_HEADER, chosenYear } from "@/lib/academic-year";
import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * A write in a year that is not the working year is refused by Postgres with
 * 25006 ("cannot execute UPDATE in a read-only transaction", 0355). Every
 * screen shows `error.message`, so the sentence is put there once, here,
 * rather than in each of a hundred server actions.
 */
async function yearAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status < 400 || !(res.headers.get("content-type") ?? "").includes("json")) return res;
  try {
    const body = JSON.parse(await res.clone().text());
    if (body && body.code === "25006") {
      return new Response(JSON.stringify({ ...body, message: READ_ONLY_YEAR_MESSAGE }), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
  } catch {
    // Not a PostgREST error body: pass it on unchanged.
  }
  return res;
}

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers. Reads/writes auth cookies via next/headers -- the cookie
 * write in a Server Component is a no-op (Next.js can't set cookies there),
 * which is fine because middleware.ts refreshes the session on every request.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // The year this person chose to look at, if any (0355). Postgres checks it
  // belongs to their college and makes the request read-only unless it is the
  // working year; the app only carries it.
  const year = await chosenYear();

  return createServerClient<Database>(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component -- middleware handles refresh.
          }
        },
      },
      global: year ? { headers: { [YEAR_HEADER]: year }, fetch: yearAwareFetch } : undefined,
    },
  );
}
