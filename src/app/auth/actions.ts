"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { passwordProblem } from "@/lib/validations/password";

export type AuthFormState = { error: string | null; sent?: boolean };

async function appOrigin(): Promise<string | null> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin?.startsWith("http")) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * "Forgotten your password?" (0289). The answer is the same whether or not
 * the address has a login: saying which would let anybody test addresses
 * against the college's list of families.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address" };
  }

  const origin = await appOrigin();
  if (!origin) return { error: "This page could not tell where it is running. Try again." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset`,
  });
  return { error: null, sent: true };
}

/** The page the emailed link opens, once the callback has set a session. */
export async function resetPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getT();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const problem = passwordProblem(password, confirm);
  if (problem) return { error: t(problem === "tooShort" ? "auth.reset.tooShort" : "auth.reset.mismatch") };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: t("auth.reset.expired") };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/");
}
