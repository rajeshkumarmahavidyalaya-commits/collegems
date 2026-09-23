import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type MessageKey, type Messages } from "./messages/en";
import { hi } from "./messages/hi";
import { ur } from "./messages/ur";

import { translatorFrom, type ClientMessages, type Translator } from "./translator";

export type { MessageKey };
export type { Translator, Values, ClientMessages } from "./translator";

const CATALOGUES: Record<Locale, Messages> = { en, hi, ur };

export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale] ?? en;
}

/**
 * The translator for a server caller: this locale's catalogue over English.
 * The browser builds the same thing from `clientMessagesFor` (see
 * `translator.ts`), so the two cannot answer a key differently.
 *
 * **Falling back is silent, and that is the right runtime behaviour.** A parent
 * looking at a half-translated screen is better served by an English sentence
 * than by a raw key or an empty space. What must not be silent is the *state* —
 * so the honesty lives in `localeCoverage()` and in a test that fails when a
 * locale slips, exactly as `channelState` carries the honesty the old
 * `CHANNELS[].live` constant used to.
 */
export function createTranslator(locale: Locale): Translator {
  return translatorFrom(locale, messagesFor(locale), messagesFor(DEFAULT_LOCALE));
}

/**
 * What the browser is given: this locale's catalogue with English filled in
 * underneath, as one plain object. The root layout passes it to the provider,
 * so a client bundle never contains a catalogue and the page is still rendered
 * in the reader's language on the server -- no flash of English.
 */
export function clientMessagesFor(locale: Locale): ClientMessages {
  if (locale === DEFAULT_LOCALE) return messagesFor(DEFAULT_LOCALE);
  return { ...messagesFor(DEFAULT_LOCALE), ...messagesFor(locale) };
}
