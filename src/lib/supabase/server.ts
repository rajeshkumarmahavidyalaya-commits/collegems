import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { READ_ONLY_YEAR_MESSAGE, YEAR_HEADER, chosenYear } from "@/lib/academic-year";
import type { Database } from "./database.types";
import { serverFetch } from "./fetch";
import { supabasePublishableKey, supabaseUrl } from "./env";

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
      // Every request goes through serverFetch (see fetch.ts): one retry for a
      // freshly issued token refused by the gateway, and a sentence for a write
      // in a year that is not the working year.
      global: { headers: year ? { [YEAR_HEADER]: year } : {}, fetch: serverFetch(READ_ONLY_YEAR_MESSAGE) },
    },
  );
}
