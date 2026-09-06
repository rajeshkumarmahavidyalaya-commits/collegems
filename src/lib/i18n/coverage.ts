import { LOCALE_CODES, DEFAULT_LOCALE, type Locale } from "./config";
import { en } from "./messages/en";
import { messagesFor } from "./translate";

/**
 * How complete each locale is, in sentences.
 *
 * This is `grading_scheme_problems()` applied to a message catalogue, and it
 * exists for the same reason: the thing that renders a translation and the
 * thing that judges it must not drift, and a half-finished catalogue must be
 * *shippable* rather than a build error — otherwise nobody ever starts the
 * second language.
 *
 * The runtime falls back to English silently, because a parent is better served
 * by an English sentence than by a raw key. So this is where the truth lives
 * instead, and `tests/i18n/coverage.test.ts` fails when a locale slips below
 * what it had — a translation can be finished on purpose, never lost by
 * accident.
 */
export type LocaleCoverage = {
  locale: Locale;
  translated: number;
  total: number;
  percent: number;
  missing: string[];
  /** Keys the locale has that English does not: a rename left behind. */
  stale: string[];
};

export function localeCoverage(locale: Locale): LocaleCoverage {
  const source = Object.keys(en);
  const catalogue = messagesFor(locale) as Record<string, string | undefined>;

  const missing = source.filter((key) => catalogue[key] === undefined);
  const stale = Object.keys(catalogue).filter((key) => !(key in en));
  const translated = source.length - missing.length;

  return {
    locale,
    translated,
    total: source.length,
    percent: source.length === 0 ? 100 : Math.round((translated / source.length) * 100),
    missing,
    stale,
  };
}

export function allCoverage(): LocaleCoverage[] {
  return LOCALE_CODES.map(localeCoverage);
}

/** One sentence per locale, for a screen or a build log. */
export function coverageProblems(): string[] {
  const problems: string[] = [];

  for (const coverage of allCoverage()) {
    if (coverage.locale === DEFAULT_LOCALE) {
      if (coverage.missing.length > 0) {
        problems.push(
          `The source catalogue is missing ${coverage.missing.length} of its own keys, which should be impossible.`,
        );
      }
      continue;
    }

    if (coverage.missing.length > 0) {
      problems.push(
        `${coverage.locale} is ${coverage.percent}% translated: ${coverage.missing.length} of ` +
          `${coverage.total} messages fall back to English, starting with "${coverage.missing[0]}".`,
      );
    }

    if (coverage.stale.length > 0) {
      problems.push(
        `${coverage.locale} carries ${coverage.stale.length} key(s) English no longer has ` +
          `("${coverage.stale[0]}"), so a rename was left half-done.`,
      );
    }
  }

  return problems;
}
