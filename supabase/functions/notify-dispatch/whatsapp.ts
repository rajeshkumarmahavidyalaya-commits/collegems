/**
 * WhatsApp, via Meta's Cloud API.
 *
 * The awkward truth this file is organised around: **WhatsApp does not accept
 * arbitrary text.** Outside a 24-hour window opened by the recipient messaging
 * the school first, Meta accepts only templates registered and approved in
 * advance -- a name, a language, and positional parameters. A school sending a
 * fee reminder is always outside that window, because nobody replies to a fee
 * reminder, so for this product the template path is the only path.
 *
 * That is why `notify_send` freezes `provider_template` and `provider_params`
 * onto the delivery, and why a WhatsApp delivery with no registered template is
 * skipped at compose time rather than queued: a queue that can never drain is
 * worse than an honest skip, because it looks like progress.
 *
 * WHAT THIS DRIVER WILL NOT DO
 *
 * It will not fall back to free text when a template is missing. Meta would
 * reject it after five retries, and the delivery log would blame the recipient
 * rather than the configuration.
 */

export type WhatsAppCredentials = {
  phoneNumberId: string;
  accessToken: string;
};

export function readCredentials(schoolPhoneNumberId: string | null): WhatsAppCredentials | null {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!accessToken) return null;

  // The school's own number wins where it has one -- a group of schools on one
  // deployment each have their own WhatsApp Business number -- and the
  // deployment's is the fallback. Same shape as `TWILIO_FROM_NUMBER`.
  const phoneNumberId = schoolPhoneNumberId?.trim() || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!phoneNumberId) return null;

  return { phoneNumberId, accessToken };
}

/**
 * Meta wants the full international number, digits only. It is lenient about a
 * leading `+` and about spaces, and unforgiving about a missing country code --
 * which it cannot detect, so it cheerfully delivers to the wrong country.
 *
 * Returning null for a number with no country code is therefore the safer
 * reading, and it is a **permanent** failure: retrying will not add one, and
 * the delivery log should say what is actually wrong.
 */
export function normaliseNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  // Under 11 digits cannot carry a country code and a subscriber number: the
  // shortest real combination is a 1-digit country code and a 9-digit number.
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

export type TemplateSpec = { name: string; locale: string; params: string[] };

/** What `notify_send` froze onto the delivery, read back defensively. */
export function readTemplate(
  name: string | null,
  params: unknown,
): TemplateSpec | null {
  if (!name) return null;
  const parsed = (params ?? {}) as { locale?: string; params?: unknown };
  const values = Array.isArray(parsed.params) ? parsed.params.map((v) => String(v ?? "")) : [];
  return { name, locale: parsed.locale || "en", params: values };
}

/**
 * Which Meta errors mean *this will never work* rather than *try again*.
 *
 * The costly mistake here is the opposite of push's. Treating a rate limit as
 * permanent throws away a message a school paid to send; treating a
 * wrong-template error as transient burns five sends against a quota to be told
 * the same thing five times. So the transient list is the short, explicit one
 * and everything else in the 4xx range is permanent.
 */
export function isPermanentFailure(status: number, body: string): boolean {
  // Rate limited, or Meta having a bad minute -- always worth retrying.
  if (status === 429 || status >= 500) return false;
  if (/\b(130429|131048|131056|133016|368)\b/.test(body)) return false;

  // Recipient is not on WhatsApp, the number is malformed, or the template does
  // not exist / does not match the parameters given. None of those change on
  // their own.
  if (/\b(131026|131008|131009|132000|132001|132005|132007|132012|132015|100)\b/.test(body)) {
    return true;
  }

  return status >= 400 && status < 500;
}
