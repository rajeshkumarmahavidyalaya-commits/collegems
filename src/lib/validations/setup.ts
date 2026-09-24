/**
 * The first-run checklist (migration 0284). The database says which steps are
 * done, as booleans, for the steps the caller may act on; this file says what
 * each step is called and where it is done. No imports: the home page is a
 * Server Component and this ships nowhere else.
 */

export type SetupStepKey =
  | "profile"
  | "classes"
  | "subjects"
  | "students"
  | "fees"
  | "staff_logins"
  | "family_logins";

export type SetupStep = { key: SetupStepKey; done: boolean };

export const SETUP_STEPS: Record<SetupStepKey, { label: string; hint: string; href: string }> = {
  profile: {
    label: "Fill in the college's details",
    hint: "Name, address and phone print on every certificate and receipt.",
    href: "/settings/school",
  },
  classes: {
    label: "Create this year's classes",
    hint: "Classes and sections for the current academic year.",
    href: "/academics",
  },
  subjects: {
    label: "Give each class its subjects",
    hint: "The timetable, marks and electives all read from these.",
    href: "/academics",
  },
  students: {
    label: "Put students on the roll",
    hint: "Import a spreadsheet, or add them one at a time.",
    href: "/students/import",
  },
  fees: {
    label: "Set this year's fees",
    hint: "What each class pays, and any kinds of student who pay differently.",
    href: "/fees/setup",
  },
  staff_logins: {
    label: "Invite your staff",
    hint: "Teachers, the librarian and the accounts office each get their own login.",
    href: "/settings/team",
  },
  family_logins: {
    label: "Invite students and parents",
    hint: "Invite a whole class of families at once.",
    href: "/settings/team",
  },
};

/** Defensive: the order and the set of steps are the server's. */
export function parseSetupProgress(value: unknown): SetupStep[] {
  const steps = (value as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((raw) => {
    const s = raw as { key?: unknown; done?: unknown };
    return typeof s?.key === "string" && s.key in SETUP_STEPS
      ? [{ key: s.key as SetupStepKey, done: s.done === true }]
      : [];
  });
}

/** "3 of 7 done", agreed in one place (rule 2, 0196). */
export function setupSentence(steps: SetupStep[]): string {
  const done = steps.filter((s) => s.done).length;
  const left = steps.length - done;
  if (left === 0) return "Everything is set up.";
  return `${done} of ${steps.length} done · ${left} ${left === 1 ? "step" : "steps"} left`;
}
