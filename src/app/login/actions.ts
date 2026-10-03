"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations/auth";
import { getT } from "@/lib/i18n/server";
import { safeNext } from "@/lib/validations/password";

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

  // safeNext keeps the link inside the app: "//elsewhere" is not a path here.
  const raw = formData.get("next");
  const next = safeNext(typeof raw === "string" ? raw : null);
  if (next !== "/") redirect(next);

  // The reference's first page is School Management: a card per school, and
  // it is the super admin's (0325). `my_schools` lists only the colleges the
  // caller administers, so a non-empty list is exactly the super admin; every
  // other seat goes straight to their school's dashboard.
  const { data: schools } = await supabase.rpc("my_schools");
  redirect((schools ?? []).length > 0 ? "/schools" : "/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
