"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations/auth";
import { getT } from "@/lib/i18n/server";

export type LoginActionState = {
  error: string | null;
  fieldErrors?: Record<string, string[]>;
};

export async function login(
  _prevState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    const t = await getT();
    // A login the college switched off (0289) is told so, rather than being
    // sent round the password-reset loop for a password that is correct.
    if (error.code === "user_banned") return { error: t("login.switchedOff") };
    // Only a refusal of the credentials is "they do not match". A network
    // failure or a server error read as a wrong password sends somebody round
    // the reset loop for a password that is correct.
    if (error.code === "invalid_credentials" || error.status === 400) return { error: t("login.failed") };
    return { error: t("login.unavailable") };
  }

  const next = formData.get("next");
  redirect(typeof next === "string" && next.startsWith("/") ? next : "/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
