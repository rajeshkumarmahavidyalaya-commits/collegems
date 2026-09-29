/**
 * The first-run checklist (migration 0284; in build order since 0302). The
 * database says which steps are done and in what order, as booleans, for the
 * steps the caller may act on; this file says what each step is called and
 * where it is done. No imports: the home page is a
 * Server Component and this ships nowhere else.
 */

export type SetupStepKey =
  | "profile"
  | "classes"
  | "subjects"
  | "fees"
  | "staff"
  | "students"
  | "timetable"
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
    href: "/academics?tab=classes",
  },
  subjects: {
    label: "Give each class its subjects",
    hint: "The timetable, marks and electives all read from these.",
    href: "/academics?tab=subjects",
  },
  fees: {
    label: "Set this year's fees",
    hint: "What each class pays. Set before admitting, so the admission fee has something to bill.",
    href: "/fees/setup",
  },
  staff: {
    label: "Add your staff",
    hint: "Teachers and office staff, so they can be given classes, a timetable and pay.",
    href: "/staff",
  },
  students: {
    label: "Put students on the roll",
    hint: "Import a spreadsheet, or add them one at a time.",
    href: "/students/import",
  },
  timetable: {
    label: "Build the class routine",
    hint: "Which teacher takes which subject in which period.",
    href: "/timetable",
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
