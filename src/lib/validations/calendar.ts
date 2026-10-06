import type { Translator } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages/en";

/**
 * The school calendar's month arithmetic (0297).
 *
 * Type imports only: a test reads it without a request or a database, and a
 * type import is erased.
 * Dates stay ISO strings end to end -- they sort lexicographically, so no
 * timezone can move a holiday by a day (the arrangements.ts rule).
 */

export type CalendarKind = "holiday" | "exam" | "fee_due" | "notice" | "event";

export const CALENDAR_KINDS: CalendarKind[] = ["holiday", "exam", "fee_due", "notice", "event"];

/**
 * A kind the server sent that this build does not know is shown as itself,
 * never hidden -- the fallback is the value, not the key (rule 15).
 */
export function kindLabel(kind: string, t: Translator): string {
  return (CALENDAR_KINDS as string[]).includes(kind) ? t(`calendar.kind.${kind}` as MessageKey) : kind;
}

const MONTH = /^(\d{4})-(\d{2})$/;

/**
 * `?month=2026-09` to that month's first and last day, and its neighbours.
 * Anything unparseable falls back to the month containing `today`, so a
 * mangled link opens on this month rather than an error.
 */
export function monthWindow(param: string | undefined, today: string) {
  const m = MONTH.exec(param ?? "") ?? MONTH.exec(today.slice(0, 7))!;
  let year = Number(m[1]);
  let month = Number(m[2]);
  if (month < 1 || month > 12) {
    year = Number(today.slice(0, 4));
    month = Number(today.slice(5, 7));
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  // Day 0 of the next month is the last day of this one, in UTC so no
  // timezone shifts it.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return {
    month: `${year}-${pad(month)}`,
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(last)}`,
    prev,
    next,
  };
}

export type CalendarEntry = {
  starts_on: string;
  ends_on: string;
  kind: string;
  title: string;
  detail: string | null;
  href: string | null;
};

/**
 * Entries grouped by the day they fall on within the window. A range (an exam
 * fortnight, a holiday week) is shown on its first day in the window, with its
 * end date, rather than repeated on every day it covers.
 */
export function groupByDay(entries: CalendarEntry[], from: string): [string, CalendarEntry[]][] {
  const days = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const day = e.starts_on < from ? from : e.starts_on;
    const list = days.get(day) ?? [];
    list.push(e);
    days.set(day, list);
  }
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
