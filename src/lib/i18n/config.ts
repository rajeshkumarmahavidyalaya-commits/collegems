/**
 * The locales this build has messages for.
 *
 * This list and `reference.locales` in Postgres describe the same thing from
 * two sides, and the split is deliberate: the database says which languages a
 * *deployment* offers, this file says which ones this *build* can actually
 * render. They are the same distinction `CHANNELS[].driver` draws against
 * `notification_channel_settings` — a row in a table cannot know whether a
 * catalogue was written, and a constant compiled into the bundle cannot know
 * whether a school switched a language off.
 *
 * `localeCoverage()` in `coverage.ts` is what keeps them honest.
 *
 * No server imports here on purpose: the middleware, the root layout and a
 * client component all need `DIRECTION`, and `src/lib/storage/constants.ts`
 * exists for the same reason.
 */

export const LOCALES = [
  { code: "en", englishName: "English", nativeName: "English", direction: "ltr" },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी", direction: "ltr" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو", direction: "rtl" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export type Direction = "ltr" | "rtl";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_CODES = LOCALES.map((l) => l.code) as Locale[];

/** The cookie the login page writes, before anybody has a profile to write to. */
export const LOCALE_COOKIE = "schoolos-locale";

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as string[]).includes(value);
}

export function directionOf(locale: Locale): Direction {
  return LOCALES.find((l) => l.code === locale)?.direction ?? "ltr";
}

export function localeName(locale: Locale): string {
  return LOCALES.find((l) => l.code === locale)?.nativeName ?? locale;
}

/**
 * The BCP-47 tag handed to `Intl`. Not the same string as the locale code:
 * a school in India wants Indian digit grouping and the dd/mm order, and
 * `new Intl.NumberFormat("hi")` gives neither reliably.
 */
export function intlTag(locale: Locale): string {
  switch (locale) {
    case "hi":
      return "hi-IN";
    case "ur":
      return "ur-PK";
    default:
      return "en-IN";
  }
}

/**
 * Pick the best locale from an `Accept-Language` header. Deliberately simple:
 * it matches the primary subtag and ignores quality values, because the header
 * is step 3 of five and a wrong guess here is corrected by the person choosing
 * a language once.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    const primary = tag.split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}
