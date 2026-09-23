import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator, messagesFor, type MessageKey } from "@/lib/i18n/translate";
import { intlTag } from "@/lib/i18n/config";
import { DECISIONS, decisionHint, decisionLabel, currentlySentence, tallySentence } from "@/lib/validations/promotion";
import { RENEWAL_KINDS, renewalBlurb } from "@/lib/validations/renewals";
import { KIND_DESCRIPTION, kindDescription, scheduleSentence } from "@/lib/validations/schedules";

/**
 * The 44 label helpers, and the half of the interface they are.
 *
 * The chrome is translated — the sidebar, the data table, the login page, the
 * empty states. The module copy is not, and it is not 238 loose strings either:
 * measured, it is **44 `*Label` helpers in 12 modules, called from 95 places in
 * 57 files**, plus the prose around them. The helpers are the shared half, so
 * one edit reaches every screen that renders that badge — `channelLabel` alone
 * is on nine.
 *
 * Rule 15 already settled the shape for the formatter version of this problem:
 * *"a wrapper that adds domain meaning keeps its name and gains a `locale`
 * parameter"*. A label needs a lookup rather than a computation, so it gains a
 * **`Translator`** instead — imported as a type, so a validations module still
 * drags nothing new into the bundle.
 *
 * This is the floor from `i18n.test.ts` turned around. A per-locale floor says
 * how much of the catalogue exists; this says how much of the interface reaches
 * it. **Move a name into `LOCALE_AWARE` and lower `STILL_ENGLISH` when a helper
 * is converted; never the other way**, for the same reason a coverage floor is
 * never lowered — the only way it can fail is that somebody's work was undone.
 */
const LOCALE_AWARE = new Set([
  "notices.categoryLabel",
  "live-classes-display.lessonStatusLabel",
  "online-tests-display.sittingStateLabel",
  // The family-facing batch: the badges a parent or a student actually reads.
  "attendance.statusLabel",
  "student-leave.kindLabel",
  "student-leave.statusLabel",
  "exams.examKindLabel",
  "exams.resultLabel",
  "homework.submissionStatusLabel",
  "homework.materialKindLabel",
  "fees-display.entryTypeLabel",
  "fees-display.methodLabel",
  // The rest of the family's menu: the inbox, and the days of the week.
  "notifications.channelLabel",
  "notifications.statusLabel",
  "notifications.audienceKindLabel",
  // The staff daily-work batch.
  "timetable.periodLabel",
  "substitutions.periodLabel",
  // Moved out of `substitutions` by `0266`: six modules had written their own
  // `severityTone` beside this module's copy of the vocabulary, so how bad a
  // finding is now has one home. `substitutions` re-exports it, and this list
  // names the **definition**.
  "severity.severityLabel",
  "substitutions.reasonLabel",
  "staff-display.staffStatusLabel",
  "certificates.kindLabel",
  // The money-and-stores batch: payroll, the journal, the fee calendar, the
  // store ledger. Three more names that mean different things in different
  // modules -- `hr.PAYMENT_METHODS` is four ways to pay a teacher and
  // `fees-display.PAYMENT_METHODS` is seven ways to take a fee -- which is why
  // each has its own key prefix rather than a shared one.
  "homework.dueLabel",
  "hr.paymentMethodLabel",
  "hr.attendanceLabel",
  "hr.leaveStatusLabel",
  "hr.runStatusLabel",
  "accounts.accountTypeLabel",
  "accounts.voucherStatusLabel",
  "accounts.sourceKindLabel",
  "fees.frequencyLabel",
  "concessions.kindLabel",
  "concessions.statusLabel",
  "inventory.movementLabel",
  // The office batch, and the last of them. Everything above is a screen a
  // family reaches; these are the ones only staff see -- the admissions funnel,
  // the rollover, the schedule register, the audit trail -- which is precisely
  // why they were last and not why they matter less. A college whose office
  // works in Hindi reads these every day and the family screens twice a term.
  "academics.subjectKindLabel",
  "audit.actionLabel",
  "checks.checkStatusLabel",
  "front-office.sourceLabel",
  "front-office.stageLabel",
  "hostel.hostelKindLabel",
  "promotion.decisionLabel",
  "promotion.leftBehindLabel",
  "renewals.renewalKindLabel",
  "schedules.kindLabel",
  "transport.directionLabel",
]);

/**
 * Helpers that end in `Label` and are deliberately **not** translated, each
 * with the reason. This is not a second exception list for work not yet done —
 * `STILL_ENGLISH` is 0 and stays 0 — it is for a name that looks like a label
 * and is not one.
 *
 * The distinction is `WEEKDAYS` run backwards. That one was deleted because
 * `Intl` already knew the answer; this one stays because **there is no answer
 * to ask for**: the input is not a value this product chose from a list, so
 * there is no finite set of words to catalogue.
 */
const NOT_A_LABEL: Record<string, string> = {
  "audit.fieldLabel":
    "Takes an arbitrary Postgres column name from any of a hundred tables and " +
    "makes it readable — `substitute_staff_id` into `Substitute staff id`. That " +
    "is an identifier, not a word this product named, so translating it would " +
    "mean cataloguing the schema and inventing a key for every column anybody " +
    "adds. Its `toUpperCase()` is safe for the same reason and only for that " +
    "reason: a Postgres identifier is ASCII, so it is not the English-only " +
    "`.toLowerCase()` rule 15 names — that one operates on a *translated* label.",
};

/** How many still render English to every reader. Only ever goes down. */
const STILL_ENGLISH = 0;

type Helper = { module: string; name: string; takesTranslator: boolean };

function helpers(): Helper[] {
  const dir = join(process.cwd(), "src/lib/validations");
  const out: Helper[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/^export function ([a-zA-Z]*Label)\s*\(([^)]*)\)/gm)) {
      out.push({
        module: file.replace(/\.ts$/, ""),
        name: m[1],
        takesTranslator: /:\s*Translator\b/.test(m[2]),
      });
    }
  }
  return out;
}

describe("a label a family reads is looked up, not hardcoded", () => {
  it("every helper claimed as locale-aware really takes a translator", () => {
    const found = new Map(helpers().map((h) => [`${h.module}.${h.name}`, h]));

    for (const key of LOCALE_AWARE) {
      const helper = found.get(key);
      expect(helper, `${key} is claimed here but no longer exists`).toBeDefined();
      expect(
        helper!.takesTranslator,
        `${key} was converted and has lost its Translator parameter — a reader who ` +
          `chose Urdu is back to an English badge`,
      ).toBe(true);
    }
  });

  it("names every deliberate exception, rather than leaving it in the count", () => {
    // The `NOT_YET_A_CONTROL` shape: an exception is a line somebody wrote on
    // purpose, with the reason beside it. A stale one — a helper that was
    // converted or deleted and left named here — would quietly shrink what the
    // assertion below covers, so it is an error in its own right.
    const found = new Map(helpers().map((h) => [`${h.module}.${h.name}`, h]));

    for (const [key, reason] of Object.entries(NOT_A_LABEL)) {
      expect(found.get(key), `${key} is excused here but no longer exists`).toBeDefined();
      expect(
        found.get(key)!.takesTranslator,
        `${key} now takes a Translator, so it is a label after all — move it into ` +
          `LOCALE_AWARE rather than leaving it excused`,
      ).toBe(false);
      expect(reason.length, `${key} needs a reason, not an entry`).toBeGreaterThan(40);
    }
  });

  it("does not grow the number that still render English", () => {
    const english = helpers().filter(
      (h) =>
        !h.takesTranslator &&
        !LOCALE_AWARE.has(`${h.module}.${h.name}`) &&
        !(`${h.module}.${h.name}` in NOT_A_LABEL),
    );

    expect(
      english.length,
      `${english.length} label helpers still hardcode English (${english
        .map((h) => `${h.module}.${h.name}`)
        .join(", ")}). That is allowed to shrink, never to grow: a new helper takes a ` +
        `Translator, like the formatters take a locale. If it genuinely is not a label — ` +
        `its input is an identifier rather than a value from a list — name it in ` +
        `NOT_A_LABEL with the reason.`,
    ).toBeLessThanOrEqual(STILL_ENGLISH);
  });

  it("translates the hint under a label, not just the label", () => {
    // The second-consumer failure, pinned. A hint renders directly beneath the
    // name on the same control, so a card whose heading is Urdu over a sentence
    // in English is one value shown in two languages — which is the thing the
    // family batch wrote down and this batch is the first to have to act on,
    // because the office screens are where the hints live.
    const t = createTranslator("hi");
    expect(decisionHint("promote", t)).not.toBe(
      DECISIONS.find((d) => d.value === "promote")!.hint,
    );
    expect(renewalBlurb("transport", t)).not.toBe(
      RENEWAL_KINDS.find((k) => k.value === "transport")!.blurb,
    );
    expect(kindDescription("fees.due_reminder", t)).not.toBe(
      KIND_DESCRIPTION["fees.due_reminder"],
    );
  });

  it("builds a sentence rather than lowercasing a translated word", () => {
    // `decisionLabel(d).toLowerCase()` stood at two call sites in the promotion
    // module and survived every earlier sweep, because this module's label was
    // still English so the call was still doing something. Hindi and Urdu have
    // no letter case: the operation is a no-op there and wrong in Turkish.
    // Rule 15's answer is that the sentence is the unit, not the word.
    const hi = createTranslator("hi");
    const en = createTranslator("en");

    expect(currentlySentence("promote", en)).toBe("Currently Promote");
    // The Hindi sentence contains the Hindi decision and no English at all.
    expect(currentlySentence("promote", hi)).toContain(decisionLabel("promote", hi));
    expect(currentlySentence("promote", hi)).not.toContain("Promote");

    expect(tallySentence("repeat", 12, en)).toBe("12 Repeat");
  });

  it("asks Intl for an ordinal instead of spelling the English rule", () => {
    // `["th","st","nd","rd"][n % 10]` with a hand-written 11/12/13 exception is
    // the English ordinal rule in a ternary — the `WEEKDAYS` mistake one step
    // along. Intl.PluralRules already knows it, and returns `other` for every
    // number in Hindi and Urdu, where the suffix simply disappears.
    const en = createTranslator("en");
    const hi = createTranslator("hi");
    const day = (n: number, t: ReturnType<typeof createTranslator>) =>
      scheduleSentence({ run_at: "10:00:00", weekdays: [], day_of_month: n }, t);

    expect(day(1, en)).toContain("1st");
    expect(day(2, en)).toContain("2nd");
    expect(day(3, en)).toContain("3rd");
    // The teens, which is the half a hand-written rule gets wrong.
    expect(day(11, en)).toContain("11th");
    expect(day(12, en)).toContain("12th");
    expect(day(13, en)).toContain("13th");
    expect(day(21, en)).toContain("21st");

    // No English suffix leaks into a language that does not have one.
    expect(day(1, hi)).not.toContain("1st");
    expect(day(1, hi)).toContain("1");
  });

  it("has an ordinal key for every category Intl produces, in every locale", () => {
    // The generalisable half, and the one that actually found a bug.
    //
    // The first draft assumed Hindi and Urdu return `other` for every number.
    // Urdu does. **Hindi returns five categories** — 1 / 2,3 / 4 / 6 / the rest
    // — because its ordinals are distinct words rather than suffixes. The four
    // missing keys fell through to English, and the English entry is not a word
    // but a *rule*: `"{n}st"`. So a Hindi reader was shown
    // "हर माह की 1st तारीख़ को".
    //
    // Silent fallback to English is the right runtime behaviour for a missing
    // *translation* and exactly wrong for a missing *rule*. Where a key holds a
    // locale rule rather than a sentence, every branch of it has to exist in
    // every locale — so this asks `Intl` which branches there are rather than
    // trusting anybody's reading of CLDR.
    for (const locale of ["en", "hi", "ur"] as const) {
      const t = createTranslator(locale);
      const pr = new Intl.PluralRules(intlTag(locale), { type: "ordinal" });
      const categories = new Set<string>();
      for (let n = 1; n <= 100; n++) categories.add(pr.select(n));

      for (const category of categories) {
        const key = `schedules.ordinal.${category}`;
        expect(
          messagesFor(locale)[key as MessageKey],
          `${locale} has no ${key}, so a day in that category falls back to the ` +
            `English ordinal rule and prints an English suffix inside a ${locale} sentence`,
        ).toBeDefined();
        // And the fallback that would have been used is not what renders.
        if (locale !== "en") {
          expect(t(key as MessageKey, { n: 1 })).not.toMatch(/st|nd|rd|th/);
        }
      }
    }
  });
});
