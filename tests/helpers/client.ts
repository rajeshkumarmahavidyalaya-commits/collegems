import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

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
