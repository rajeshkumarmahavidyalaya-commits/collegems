import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CODES,
  directionOf,
  intlTag,
  isLocale,
  localeFromAcceptLanguage,
} from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { allCoverage, coverageProblems, localeCoverage } from "@/lib/i18n/coverage";
import { formatCurrency, formatDate, formatNumber } from "@/lib/i18n/format";
import { en } from "@/lib/i18n/messages/en";

/**
 * A translation can be finished on purpose; it must never be lost by accident.
 *
 * The runtime falls back to English silently, because a parent is better served
 * by an English sentence than by a raw key — so nothing at runtime will ever
 * tell you a catalogue slipped. These are what tell you.
 */
describe("locale coverage", () => {
  /**
   * The floor each locale has reached. **Raise these when a translation is
   * finished; never lower them.** A dropped key is the only way one of these
   * can fail, and lowering the number to make it pass is deleting somebody's
   * work and calling it a fix.
   */
  //
  // All three sit at 100 today. The floor is 95 rather than 100 on purpose: a
  // few English keys may land ahead of their translations without stopping the
  // build, which is the bargain that lets a second language exist at all. A
  // real regression -- somebody deleting a block -- still fails.
  const FLOOR: Record<string, number> = { en: 100, hi: 95, ur: 95 };

  it.each(LOCALE_CODES)("%s has not slipped below its floor", (locale) => {
    const coverage = localeCoverage(locale);
    expect(
      coverage.percent,
      `${locale} is ${coverage.percent}% translated; missing: ${coverage.missing.slice(0, 5).join(", ")}`,
    ).toBeGreaterThanOrEqual(FLOOR[locale]);
  });

  it("has no key in a translation that English has dropped", () => {
    for (const coverage of allCoverage()) {
      expect(coverage.stale, `${coverage.locale} carries: ${coverage.stale.join(", ")}`).toEqual([]);
    }
  });

  it("says what is wrong in sentences rather than in a boolean", () => {
    for (const problem of coverageProblems()) {
      expect(problem.length).toBeGreaterThan(20);
      expect(problem).toMatch(/\.$/);
    }
  });

  it("keeps every plural key in matched pairs", () => {
    // A `.one` with no `.other` renders as a raw key for every count but 1,
    // which is the kind of bug that only shows up on the second row of a table.
    const keys = Object.keys(en);
    for (const key of keys) {
      if (key.endsWith(".one")) {
        expect(keys, key).toContain(`${key.slice(0, -4)}.other`);
      }
    }
  });
});

describe("translating", () => {
  it("falls back to English for whatever is untranslated, rather than showing a key", () => {
    // Asserted as a property rather than against a chosen key: the set of
    // untranslated keys changes every time somebody finishes a sentence, and a
    // test that names one of them fails for the best possible reason.
    for (const locale of LOCALE_CODES) {
      const t = createTranslator(locale);
      for (const key of localeCoverage(locale).missing) {
        expect(t(key as keyof typeof en), `${locale}/${key}`).toBe(en[key as keyof typeof en]);
      }
    }
  });

  it("shows the key itself when English does not have it either", () => {
    // Not a translation gap but a programming mistake, and the loudest thing
    // that is still safe to render on somebody's screen.
    const t = createTranslator("en");
    expect(t("no.such.key" as keyof typeof en)).toBe("no.such.key");
  });

  it("interpolates by name", () => {
    const t = createTranslator("en");
    expect(t("app.signedInAs", { name: "Rajesh" })).toBe("Signed in as Rajesh");
  });

  it("leaves a placeholder alone rather than writing undefined", () => {
    const t = createTranslator("en");
    // "Hello undefined" is a bug people laugh at and do not report; a visible
    // {name} is one they report.
    expect(t("app.signedInAs")).toContain("{name}");
  });

  it("picks the plural form and passes the count through", () => {
    const t = createTranslator("en");
    expect(t.plural("state.showingOf", 1, { shown: 1, total: 1 })).toBe("Showing 1 of 1 row");
    expect(t.plural("state.showingOf", 4, { shown: 4, total: 9 })).toBe("Showing 4 of 9 rows");
  });

  it("uses the translated plural when there is one", () => {
    const t = createTranslator("hi");
    expect(t.plural("state.selected", 3)).toBe("3 चयनित");
  });
});

describe("direction", () => {
  it("knows which languages run right to left", () => {
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("hi")).toBe("ltr");
    expect(directionOf("ur")).toBe("rtl");
  });

  it("has at least one right-to-left locale, so the support is exercised", () => {
    // RTL that nothing uses is RTL that is broken and nobody has noticed.
    expect(LOCALES.some((l) => l.direction === "rtl")).toBe(true);
  });
});

describe("choosing a locale from a browser", () => {
  it("matches on the primary subtag", () => {
    expect(localeFromAcceptLanguage("hi-IN,hi;q=0.9,en;q=0.8")).toBe("hi");
    expect(localeFromAcceptLanguage("ur-PK,ur;q=0.9")).toBe("ur");
  });

  it("skips languages this build has no messages for", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en-GB;q=0.8")).toBe("en");
  });

  it("returns null rather than guessing when the header says nothing useful", () => {
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("refuses a locale that is not one of ours", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });
});

describe("formatting", () => {
  it("uses an Indian tag for every locale, because the school is in India", () => {
    // The reader's language changes; the school's conventions do not. A fee of
    // 1,00,000 is written that way in Hindi and in Urdu too.
    expect(intlTag("en")).toBe("en-IN");
    expect(intlTag("hi")).toBe("hi-IN");
  });

  it("renders money as rupees in every language", () => {
    for (const locale of LOCALE_CODES) {
      expect(formatCurrency(18900, locale)).toMatch(/(₹|Rs|INR)/);
    }
  });

  it("never renders a missing value as zero", () => {
    // The difference between "not entered" and "zero" is the difference
    // between an incomplete record and a bad one, everywhere in this codebase.
    expect(formatNumber(null, "en")).toBe("—");
    expect(formatDate(null, "en")).toBe("—");
    expect(formatDate("not a date", "en")).toBe("—");
    expect(formatNumber(0, "en")).toBe("0");
  });
});
