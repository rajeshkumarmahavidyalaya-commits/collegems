"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/validations/platform";

export type SignupActionState = {
  error: string | null;
  notice: string | null;
  fieldErrors?: Record<string, string[]>;
};

/**
 * Create the login, and nothing else.
 *
 * Deliberately does **not** create a school. Rule 3's trigger fires on this
 * insert and looks for a pending invitation; if there is one, this person is
 * joining an existing school and is finished. If there is not, they land on
 * `/start` with no tenant — which rule 3 calls "the correct failure mode" and
 * which is also, exactly, the state of somebody about to start a school.
 *
 * So there is one signup form for both, and the difference is decided by a row
 * that already exists rather than by a radio button somebody has to understand.
 */
export async function signup(
  _prevState: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return {
      error: "Check the highlighted fields.",
      notice: null,
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Never confirm or deny that an address is already registered: that turns
    // this form into a way to enumerate a school's staff. The message is the
    // same either way and the person is pointed at signing in.
    if (/already|exists|registered/i.test(error.message)) {
      return {
        error: null,
        notice:
          "If that address does not already have an account, we have sent it a confirmation link. If it does, sign in instead.",
        fieldErrors: undefined,
      };
    }
    return { error: error.message, notice: null };
  }

  // Email confirmation on: there is no session yet, so there is nothing to
  // redirect into. Say what happens next rather than dropping them on a login
  // page that will refuse them.
  if (!data.session) {
    return {
      error: null,
      notice: `Check ${parsed.data.email} for a confirmation link, then sign in.`,
    };
  }

  redirect("/start");
}
