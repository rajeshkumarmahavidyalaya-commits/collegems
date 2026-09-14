import { describe } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The four variables the database-backed suites cannot run without.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` and the publishable key are checked too, because a
 * checkout with `.env.local` but no `.env.test.local` has the project but not
 * the logins, and that is the common case.
 */
const DATABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TEST_TENANT_A_EMAIL",
  "TEST_TENANT_A_PASSWORD",
  "TEST_TENANT_B_EMAIL",
  "TEST_TENANT_B_PASSWORD",
] as const;

export function missingDatabaseEnv(): string[] {
  return DATABASE_ENV.filter((name) => !process.env[name]);
}

/**
 * `describe` for a suite that needs the real database.
 *
 * Before this, 49 of the 97 test files **failed** on a checkout without
 * credentials — `requireEnv` throws, and `npm test` was red in every
 * environment that had not been set up. That is this codebase's own rule
 * turned on its own suite: *a check that can never go green is a check people
 * learn to ignore*, and worse, a red suite by default makes a real regression
 * indistinguishable from a missing password.
 *
 * Skipping is not the same as passing, and the distinction has to be visible:
 * vitest reports these as skipped with a count, and `tests/setup.ts` prints
 * once which variables are missing. A suite that is quietly absent would be the
 * defect this fixes, wearing the other face.
 */
/**
 * A **function**, not a const, and that is load-bearing. `tests/setup.ts`
 * imports this module in order to warn about the missing variables — so a
 * `const` initialiser here would run before `config()` had loaded
 * `.env.test.local`, and every database suite would skip even on a machine
 * that has the credentials. Deciding at call time is what makes it correct,
 * because a test file's body runs after the setup file.
 */
export function describeDb(name: string, fn: () => void): void {
  if (missingDatabaseEnv().length > 0) {
    describe.skip(name, fn);
  } else {
    describe(name, fn);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.test.local and fill in the two test tenant logins.`,
    );
  }
  return value;
}

/** A Supabase client signed in as the given user -- subject to RLS exactly like the app is. */
export async function signedInClient(
  emailVar: string,
  passwordVar: string,
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error } = await client.auth.signInWithPassword({
    email: requireEnv(emailVar),
    password: requireEnv(passwordVar),
  });

  if (error) throw new Error(`Could not sign in ${emailVar}: ${error.message}`);
  return client;
}

export const tenantAClient = () =>
  signedInClient("TEST_TENANT_A_EMAIL", "TEST_TENANT_A_PASSWORD");

export const tenantBClient = () =>
  signedInClient("TEST_TENANT_B_EMAIL", "TEST_TENANT_B_PASSWORD");
