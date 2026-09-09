import { intlTag, type Locale } from "./config";

/**
 * Dates, times, numbers and money, in the reader's locale.
 *
 * This exists because the codebase was full of `toLocaleDateString("en-IN")` —
 * correct for one school and wrong the moment somebody reads the same screen in
 * Hindi or Urdu. Hardcoding a tag is the same class of mistake as hardcoding a
 * grading rule: it works for the first customer.
 *
 * Currency is **not** localised away from INR. The rupee is a fact about the
 * money, not about the reader: a fee of ₹18,900 is ₹18,900 in every language,
 * and only the digit grouping and the symbol's placement move.
 */

function formatter<T extends Intl.DateTimeFormat | Intl.NumberFormat>(make: () => T): T | null {
  try {
    return make();
  } catch {
    // A runtime without the locale data must degrade to something readable
    // rather than throwing inside a render.
    return null;
  }
}

export function formatDate(
  value: string | Date | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" },
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const fmt = formatter(() => new Intl.DateTimeFormat(intlTag(locale), options));
  return fmt ? fmt.format(date) : date.toISOString().slice(0, 10);
}

export function formatTime(
  value: string | Date | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const fmt = formatter(() => new Intl.DateTimeFormat(intlTag(locale), options));
  return fmt ? fmt.format(date) : date.toISOString().slice(11, 16);
}

/**
 * A date and a time together.
 *
 * Separate from `formatDate` because a receipt taken at 09:14 and a fee due on
 * the 15th are different facts, and because callers were reaching for
 * `toLocaleString(undefined, …)` — the *browser's* locale — for want of this.
 */
export function formatDateTime(
  value: string | Date | null | undefined,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const fmt = formatter(() => new Intl.DateTimeFormat(intlTag(locale), options));
  return fmt ? fmt.format(date) : date.toISOString().slice(0, 16).replace("T", " ");
}

/** `2026-02-01` → `February 2026`, in the reader's language. */
export function formatMonth(
  periodMonth: string | null | undefined,
  locale: Locale,
): string {
  if (!periodMonth) return "—";
  const [year, month] = periodMonth.split("-").map(Number);
  if (!year || !month) return periodMonth;
  return formatDate(new Date(Date.UTC(year, month - 1, 1)), locale, {
    month: "long",
    year: "numeric",
  });
}

export function formatNumber(
  value: number | string | null | undefined,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(number)) return "—";

  const fmt = formatter(() => new Intl.NumberFormat(intlTag(locale), options));
  return fmt ? fmt.format(number) : String(number);
}

export function formatCurrency(
  value: number | string | null | undefined,
  locale: Locale,
  currency = "INR",
): string {
  return formatNumber(value, locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

/**
 * A number that has to line up in a column. Grouping separators differ by
 * locale and that is fine; what is not fine is a table where 1,00,000 and
 * 100000 sit in adjacent rows because two components chose differently.
 */
export function formatQuantity(
  value: number | string | null | undefined,
  locale: Locale,
  decimals = 2,
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
