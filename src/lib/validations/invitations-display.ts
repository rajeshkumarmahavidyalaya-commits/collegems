/**
 * What a role stands for, and the question to ask about it.
 *
 * **No imports at all**, deliberately. These three exports were first written
 * in `platform.ts`, which begins `import { z } from "zod"` — and the moment the
 * invite picker imported `SUBJECT_PROMPT` from there, `/settings/team` went
 * **149 kB → 176 kB**. Twenty-seven kilobytes of Zod, shipped to a browser so
 * that a label could be read.
 *
 * That is `fees-display.ts`'s split, made a second time, and CLAUDE.md already
 * warns about it in the words that describe this file: *one `import { z }` and
 * it silently becomes the thing it was extracted from.* Measured after the
 * split: **150 kB**.
 */

/** The kinds of record a login can stand for — `roles.subject`, migration `0224`. */
export const ROLE_SUBJECTS = ["staff", "student", "guardian", "none"] as const;
export type RoleSubject = (typeof ROLE_SUBJECTS)[number];

/**
 * What the picker asks for, per kind.
 *
 * Which kind is a property of the **role**, not of the tier: `parent` and
 * `student` share the `student` tier and need a guardian and a student
 * respectively. `none` has no prompt because there is nothing to ask.
 */
export const SUBJECT_PROMPT: Record<Exclude<RoleSubject, "none">, string> = {
  staff: "Which member of staff is this login for?",
  student: "Which student is this login for?",
  guardian: "Whose parent or guardian is this login for?",
};

/**
 * What `invitation_announce` did, per channel.
 *
 * One row per channel in `reference.notification_types.default_channels` for
 * `invitation.sent`. `segments` is the SMS cost and is null for every other
 * channel **and for a skipped SMS** — migration `0234`: a message that was not
 * sent has no price, and zero would say it cost nothing.
 */
export type AnnouncedChannel = {
  channel: string;
  status: string;
  reason: string | null;
  segments: number | null;
};

/**
 * The past tense of a channel, because a toast says what happened.
 *
 * Not `channelLabel` from `notifications.ts` — that one names the channel
 * ("Email", "SMS") for a settings screen, and this one finishes the sentence
 * *"Invited Anika Verma. Emailed and texted."* Same word, different job; rule
 * 15's `periodLabel` collision, at a smaller scale.
 */
const SENT_BY: Record<string, string> = {
  email: "emailed",
  sms: "texted",
  whatsapp: "messaged on WhatsApp",
  push: "pushed",
  in_app: "posted to their inbox",
};

/**
 * Split an announcement into what went and what did not.
 *
 * Both halves are needed by both screens, and a school that reads only the
 * first comes to believe every family was told — which is the sentence this
 * module has now made three times, for a notice, for a payment and for an
 * invitation.
 */
export function describeAnnouncement(rows: AnnouncedChannel[]): {
  sent: string[];
  held: { channel: string; reason: string }[];
  parts: number;
} {
  const sent = rows
    .filter((r) => r.status === "queued")
    .map((r) => SENT_BY[r.channel] ?? r.channel);

  const held = rows
    .filter((r) => r.status === "skipped")
    .map((r) => ({ channel: r.channel, reason: r.reason ?? "no reason recorded" }));

  const parts = rows.reduce((total, r) => total + (r.segments ?? 0), 0);

  return { sent, held, parts };
}

/**
 * "emailed and texted" — `Intl.ListFormat` owns the conjunction (rule 15).
 *
 * Explicitly `"en"`, and that is not the hardcoded-tag bug rule 15 names. That
 * bug is formatting *data* in a fixed locale while the reader chose another;
 * here the words being joined are two hardcoded English past participles inside
 * a hardcoded English toast, so joining them in the reader's locale would
 * produce a Hindi conjunction between two English words. The debt is that this
 * module's sentences are not translated yet — one debt, not two — and the day
 * they are, this takes the translator's locale with them.
 *
 * Passing `undefined` would be worse than either: it formats in the *browser's*
 * locale, which is the quieter tell rule 15 records for the same mistake.
 */
export function joinWords(words: string[]): string {
  if (words.length === 0) return "";
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(words);
}
