import type { MessageKey } from "@/lib/i18n/messages/en";
import type { Translator } from "@/lib/i18n/translate";

/**
 * One lookup, shared by every `*Label` helper.
 *
 * Rule 15 settled the shape — *"a wrapper that adds domain meaning keeps its
 * name and gains a `locale` parameter"* — and a label needs a translator rather
 * than a locale because a word is looked up, not computed. What this adds is the
 * **fallback**, and getting it right is the whole reason this is one function
 * instead of twelve copies of two lines.
 *
 * `createTranslator` returns the *key* for a message it cannot find, which is
 * correct for a missing translation on a page — a raw key is the loudest thing
 * that is still safe — and wrong for a value on a badge: a school that adds a
 * `staff_only` notice category tomorrow would see `notices.category.staff_only`
 * printed on it. So the constant keeps its English `label`, and that is what a
 * value with no key falls back to.
 *
 * This is the bargain `nav-config.ts` already makes, written down there as
 * *"leaving both here means a new entry works before its translation exists"*.
 * Same trade, made once, where the next helper can inherit it.
 *
 * **No value imports.** `Translator` and `MessageKey` are types and are erased,
 * so a validations module that calls this still pulls nothing new into the
 * browser — which is the `fees-display.ts` split's whole point.
 */
export function labelFor(key: string, fallback: string, t: Translator): string {
  const translated = t(key as MessageKey);
  return translated === key ? fallback : translated;
}

/**
 * A picker's options, named in the reader's language.
 *
 * The second consumer, and the one that makes this worth doing at all. A
 * label lives on the constant, so it has **two** readers — the badge helper and
 * the `<Select>` that lists every value — and translating one without the other
 * puts the same value on one screen in two languages. Measured before starting:
 * `PAYMENT_METHODS.label` is rendered directly in 3 files, `CHANNELS` in 5,
 * `ATTENDANCE_STATUSES` and `EXAM_KINDS` in 2 each.
 */
export function optionsFor<T extends { value: string; label: string }>(
  values: readonly T[],
  prefix: string,
  t: Translator,
): (T & { label: string })[] {
  return values.map((v) => ({ ...v, label: labelFor(`${prefix}.${v.value}`, v.label, t) }));
}
