import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  directionOf,
  isLocale,
  localeFromAcceptLanguage,
  type Direction,
  type Locale,
} from "./config";
import { createTranslator, type Translator } from "./translate";

/**
 * Which language to speak, resolved server-side — the same instinct as
 * `getUserContext()` and `current_session_id()`. The client never decides.
 *
 * THE ORDER, and why each step is where it is:
 *
 *   1. `user_profiles.locale`  what this person chose. Null means "follow the
 *      school", which is deliberately different from having chosen the school's
 *      language: if the school switches to Hindi, somebody who never expressed
 *      a preference switches with it and somebody who chose English does not.
 *   2. the cookie              what they chose *before* signing in. This is the
 *      step that makes the login page usable by somebody who cannot read the
 *      default — they have no profile yet, so there is nowhere else to put it.
 *   3. `Accept-Language`       what the browser asked for.
 *   4. `tenants.default_locale` what the school runs in.
 *   5. English.
 *
 * `cache()` de-dupes it across every Server Component in one request, so the
 * layout and a leaf both asking costs one query.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;

  const supabase = await createClient();

  let user: { id: string } | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data?.user ?? null;
  } catch {
    // Signed out, or an auth service that is having a bad minute. Either way
    // the answer is "fall through to the cookie", not a 500 on every page.
    user = null;
  }

  if (user) {
    const { data } = await supabase
      .from("user_profiles")
      .select("locale, tenants ( default_locale )")
      .eq("id", user.id)
      .maybeSingle();

    if (isLocale(data?.locale)) return data.locale;

    // The person has expressed no preference. The cookie is still a preference
    // they expressed — on the login page, a moment ago — so it outranks the
    // school's default.
    if (isLocale(fromCookie)) return fromCookie;

    const schoolDefault = data?.tenants?.default_locale;
    if (isLocale(schoolDefault)) return schoolDefault;
    return DEFAULT_LOCALE;
  }

  if (isLocale(fromCookie)) return fromCookie;

  const headerList = await headers();
  const fromBrowser = localeFromAcceptLanguage(headerList.get("accept-language"));
  if (fromBrowser) return fromBrowser;

  return DEFAULT_LOCALE;
});

export const getDirection = cache(async (): Promise<Direction> => directionOf(await getLocale()));

/** The translator, for a Server Component. `const t = await getT()`. */
export const getT = cache(async (): Promise<Translator> => createTranslator(await getLocale()));
