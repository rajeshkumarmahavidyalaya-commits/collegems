"use client";

import { createContext, useContext, useMemo } from "react";
import { directionOf, type Direction, type Locale } from "@/lib/i18n/config";
import { createTranslator, type Translator } from "@/lib/i18n/translate";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMonth,
  formatNumber,
  formatQuantity,
  formatTime,
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
};

const I18nContext = createContext<I18nValue | null>(null);

/**
 * The locale is resolved on the server and handed down. A client component
 * never works it out for itself — the same rule the tenant and the session
 * already follow, and for the same reason: two places that answer "who is this
 * and what do they read" will eventually answer differently.
 *
 * The catalogues travel in the bundle rather than over the wire. They are a few
 * kilobytes of text and the alternative — fetching messages after mount — is a
 * screen that renders in English and then flickers into Hindi.
 */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nValue>(() => {
    const t = createTranslator(locale);
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
    };
  }, [locale]);

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
