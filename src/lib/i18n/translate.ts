import { DEFAULT_LOCALE, intlTag, type Locale } from "./config";
import { en, type MessageKey, type Messages } from "./messages/en";
import { hi } from "./messages/hi";
import { ur } from "./messages/ur";

export type { MessageKey };

const CATALOGUES: Record<Locale, Messages> = { en, hi, ur };

export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale] ?? en;
}

export type Values = Record<string, string | number>;

function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    // A placeholder with nothing to put in it is left as it is rather than
    // rendered as "undefined": a stray `{name}` on screen is a bug report, and
    // "Hello undefined" is a bug somebody laughs at and does not report.
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

export type Translator = {
  (key: MessageKey, values?: Values): string;
  /** Picks `key.one` / `key.other` (or whatever `Intl.PluralRules` says) and
   *  passes `count` through, so a call site never spells a plural itself. */
  plural: (key: string, count: number, values?: Values) => string;
  locale: Locale;
};

/**
 * The translator, used identically on the server and in the browser.
 *
 * **Falling back is silent, and that is the right runtime behaviour.** A parent
 * looking at a half-translated screen is better served by an English sentence
 * than by a raw key or an empty space. What must not be silent is the *state* —
 * so the honesty lives in `localeCoverage()` and in a test that fails when a
 * locale slips, exactly as `channelState` carries the honesty the old
 * `CHANNELS[].live` constant used to.
 */
export function createTranslator(locale: Locale): Translator {
  const catalogue = messagesFor(locale);
  const fallback = messagesFor(DEFAULT_LOCALE);

  const t = ((key: MessageKey, values?: Values) => {
    const template = catalogue[key] ?? fallback[key];
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
    const candidates = [`${key}.${category}`, `${key}.other`, key] as MessageKey[];
    for (const candidate of candidates) {
      const template = catalogue[candidate] ?? fallback[candidate];
      if (template !== undefined) return interpolate(template, { count, ...values });
    }
    return key;
  };

  return t;
}
