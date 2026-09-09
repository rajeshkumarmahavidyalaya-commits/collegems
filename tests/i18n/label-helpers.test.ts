import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  "substitutions.severityLabel",
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
]);

/** How many still render English to every reader. Only ever goes down. */
const STILL_ENGLISH = 12;

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

  it("does not grow the number that still render English", () => {
    const english = helpers().filter(
      (h) => !h.takesTranslator && !LOCALE_AWARE.has(`${h.module}.${h.name}`),
    );

    expect(
      english.length,
      `${english.length} label helpers still hardcode English. That is allowed to shrink, ` +
        `never to grow: a new helper takes a Translator, like the formatters take a locale.`,
    ).toBeLessThanOrEqual(STILL_ENGLISH);
  });
});
