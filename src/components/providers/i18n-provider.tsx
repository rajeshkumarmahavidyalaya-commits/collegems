"use client";

import { createContext, useContext, useMemo } from "react";
import { directionOf, type Direction, type Locale } from "@/lib/i18n/config";
import { translatorFrom, type ClientMessages, type Translator } from "@/lib/i18n/translator";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonth,
  formatNumber,
  formatQuantity,
  formatTime,
  formatWeekday,
} from "@/lib/i18n/format";

type I18nValue = {
  locale: Locale;
  direction: Direction;
  t: Translator;
  formatDate: (value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatMonth: (periodMonth: string | null | undefined) => string;
  formatTime: (value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number | string | null | undefined, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (value: number | string | null | undefined, currency?: string) => string;
  formatQuantity: (value: number | string | null | undefined, decimals?: number) => string;
  formatWeekday: (isoWeekday: number, style?: "long" | "short") => string;
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * The locale is resolved on the server and handed down. A client component
 * never works it out for itself — the same rule the tenant and the session
 * already follow, and for the same reason: two places that answer "who is this
 * and what do they read" will eventually answer differently.
 *
 * **One catalogue arrives, as a prop.** The root layout passes this locale's
 * messages with English filled in underneath (`clientMessagesFor`), so the page
 * renders in the reader's language on the server and nothing flickers -- the
 * reason fetching after mount was refused. What changed is where they travel:
 * this file used to import `translate.ts`, which imports all three catalogues,
 * so every route using a translation in the browser shipped English, Hindi and
 * Urdu (one 101.6 kB chunk on 64 routes) to show one. Now it imports only
 * `translator.ts`, which imports no catalogue, and the one locale rides in the
 * layout's payload once per full page load.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: ClientMessages;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(() => {
    const t = translatorFrom(locale, messages);
    return {
      locale,
      direction: directionOf(locale),
      t,
      formatDate: (v, options) => formatDate(v, locale, options),
      formatDateTime: (v, options) => formatDateTime(v, locale, options),
      formatMonth: (v) => formatMonth(v, locale),
      formatTime: (v, options) => formatTime(v, locale, options),
      formatNumber: (v, options) => formatNumber(v, locale, options),
      formatCurrency: (v, currency) => formatCurrency(v, locale, currency),
      formatQuantity: (v, decimals) => formatQuantity(v, locale, decimals),
      formatWeekday: (d, style) => formatWeekday(d, locale, style),
    };
  }, [locale, messages]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside <I18nProvider>");
  }
  return value;
}

/** The common case, so a component that only needs strings imports one thing. */
export function useT(): Translator {
  return useI18n().t;
}
