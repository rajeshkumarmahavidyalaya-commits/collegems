"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, isLocale, type Locale } from "./config";

export type SetLocaleResult = { ok: true; locale: Locale | null } | { ok: false; error: string };

/**
 * Choose a language.
 *
 * Two writes, deliberately, because the two answer different questions:
 *
 *   - the **cookie** is what this browser reads before anybody signs in, and is
 *     the only place a choice can live on the login page;
 *   - **`user_profiles.locale`** is what this person reads on any device, and is
 *     written through `set_my_locale` because `user_profiles` has no
 *     self-update policy at all — a person must not be able to change their own
 *     `role_id`, and a column GRANT would widen it for administrators too. The
 *     narrower party gets a definer function, exactly as `homework_submit` does.
 *
 * Passing `null` means "follow the school", which is not the same as choosing
 * the school's current language: if the school switches, the first person moves
 * with it and the second does not.
 */
export async function setLocale(value: string | null): Promise<SetLocaleResult> {
  const locale = value === null || value === "" ? null : value;
  if (locale !== null && !isLocale(locale)) {
    return { ok: false, error: "This system has no messages in that language." };
  }

  const cookieStore = await cookies();
  if (locale === null) {
    cookieStore.delete(LOCALE_COOKIE);
  } else {
    cookieStore.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      // Not `httpOnly`: this is a display preference, not a credential, and a
      // client component reading it back is legitimate.
      httpOnly: false,
    });
  }

  // Signed out — the cookie is the whole answer, and that is not an error.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data?.user) {
    // `p_locale` is nullable in Postgres — null is "follow the school" — but the
    // generated argument type is not, so the null case is spelled out.
    const { error } = locale
      ? await supabase.rpc("set_my_locale", { p_locale: locale })
      : await supabase.rpc("set_my_locale", {} as { p_locale: string });
    if (error) return { ok: false, error: error.message };
  }

  // Every screen's text changes, so the whole tree is stale.
  revalidatePath("/", "layout");
  return { ok: true, locale };
}
