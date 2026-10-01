/**
 * The first-run checklist (migration 0284; in build order since 0302). The
 * database says which steps are done and in what order, as booleans, for the
 * steps the caller may act on; this file says what each step is called and
 * where it is done. No imports: the home page is a
 * Server Component and this ships nowhere else.
 */

export type SetupStepKey =
  | "profile"
  | "year"
  | "classes"
  | "subjects"
  | "fees"
  | "staff"
  | "students"
  | "timetable"
  | "messages"
  | "staff_logins"
  | "family_logins";

/**
 * `have`/`of` are counts the server sends for a step measured over people
 * (0310: families reached), so the card can say "1 of 302" rather than a bare
 * tick or cross. Never ids.
 */
export type SetupStep = { key: SetupStepKey; done: boolean; have?: number; of?: number };

export const SETUP_STEPS: Record<SetupStepKey, { label: string; hint: string; href: string }> = {
  profile: {
    label: "Fill in the college's details",
    hint: "Name, address and phone print on every certificate and receipt.",
    href: "/settings/school",
  },
  year: {
    label: "Make this year the current one",
    hint: "Everything dated today is filed under the current year. Promote students first, then switch.",
    href: "/academics/sessions",
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
  messages: {
    label: "Connect email or SMS",
    hint: "Until a provider is connected, invitations, receipts and reminders reach nobody outside the app.",
    href: "/notifications/channels",
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
    const s = raw as { key?: unknown; done?: unknown; have?: unknown; of?: unknown };
    if (typeof s?.key !== "string" || !(s.key in SETUP_STEPS)) return [];
    const step: SetupStep = { key: s.key as SetupStepKey, done: s.done === true };
    if (typeof s.have === "number" && typeof s.of === "number") {
      step.have = s.have;
      step.of = s.of;
    }
    return [step];
  });
}

/** "1 of 302 reached" for a step measured over people; null otherwise. */
export function stepCount(step: SetupStep): string | null {
  if (step.have === undefined || step.of === undefined) return null;
  return `${step.have} of ${step.of} reached`;
}

/** "3 of 7 done", agreed in one place (rule 2, 0196). */
export function setupSentence(steps: SetupStep[]): string {
  const done = steps.filter((s) => s.done).length;
  const left = steps.length - done;
  if (left === 0) return "Everything is set up.";
  return `${done} of ${steps.length} done · ${left} ${left === 1 ? "step" : "steps"} left`;
}
