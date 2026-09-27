"use server";

import { createClient } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/validations/password";
import type { ActionResult } from "../library/actions";

/**
 * Change your own password (0289). The current one is checked first by
 * signing in with it: a session left open on a shared office computer should
 * not be enough to take over the login.
 */
export async function changePassword(input: {
  current: string;
  password: string;
  confirm: string;
}): Promise<ActionResult> {
  const problem = passwordProblem(input.password, input.confirm);
  if (problem === "tooShort") return { ok: false, error: "Use at least 8 characters." };
  if (problem === "mismatch") return { ok: false, error: "The two new passwords are not the same." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) return { ok: false, error: "Not signed in." };

  const check = await supabase.auth.signInWithPassword({ email, password: input.current });
  if (check.error) return { ok: false, error: "Your current password is not right." };

  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}
