import { intlTag, type Locale } from "./config";
import type { MessageKey, Messages } from "./messages/en";

/**
 * The translator itself, with **no catalogue imported**: every import from
 * `./messages/*` here is a type and is erased.
 *
 * That is the whole point of the file. `translate.ts` holds the three
 * catalogues and is the server's entry point; this is what the browser runs.
 * Measured before the split: the client provider imported `translate.ts`, so
 * one 101.6 kB chunk -- English, Hindi *and* Urdu -- rode on 64 routes to show
 * a reader one language. Now the root layout hands the provider one locale's
 * messages, already merged over English, and nothing here pulls a catalogue
 * into a bundle. `tests/i18n/catalogue-stays-on-the-server.test.ts` fails if
 * a value import of a catalogue ever appears in this file or in the provider.
 */

export type { MessageKey };

export type Values = Record<string, string | number>;

/** A catalogue as it travels to the browser: one locale, gaps filled from English. */
export type ClientMessages = Partial<Messages>;

export type Translator = {
  (key: MessageKey, values?: Values): string;
  /** Picks `key.one` / `key.other` (or whatever `Intl.PluralRules` says) and
   *  passes `count` through, so a call site never spells a plural itself. */
  plural: (key: string, count: number, values?: Values) => string;
  locale: Locale;
};

function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    // A placeholder with nothing to put in it is left as it is rather than
    // rendered as "undefined": a stray `{name}` on screen is a bug report, and
    // "Hello undefined" is a bug somebody laughs at and does not report.
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

/**
 * Build a translator over a catalogue and, optionally, a fallback. The server
 * passes the locale's catalogue and English; the browser passes one merged
 * catalogue and no fallback -- the same lookups, answered from one object.
 */
export function translatorFrom(
  locale: Locale,
  catalogue: Partial<Messages>,
  fallback: Partial<Messages> = {},
): Translator {
  const lookup = (key: string): string | undefined =>
    (catalogue as Record<string, string | undefined>)[key] ??
    (fallback as Record<string, string | undefined>)[key];

  const t = ((key: MessageKey, values?: Values) => {
    const template = lookup(key);
    // A key with no English either is a programming mistake, not a translation
    // gap. Showing the key is the loudest thing that is still safe on a screen.
    if (template === undefined) return key;
    return interpolate(template, values);
  }) as Translator;

  t.locale = locale;

  t.plural = (key: string, count: number, values?: Values) => {
    let category: Intl.LDMLPluralRule = count === 1 ? "one" : "other";
    try {
      category = new Intl.PluralRules(intlTag(locale)).select(count);
    } catch {
      // An environment without the locale data still gets one/other.
    }
    for (const candidate of [`${key}.${category}`, `${key}.other`, key]) {
      const template = lookup(candidate);
      if (template !== undefined) return interpolate(template, { count, ...values });
    }
    return key;
  };

  return t;
}
