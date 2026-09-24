/**
 * Turning the year over, as a list of steps in the order they have to happen.
 *
 * The steps used to be on three screens (classes and promotion on /promotion,
 * fees on /fees/setup, the switch on /academics/sessions) and nothing said
 * which were done, so the year screen offered the last one first: "Make
 * 2026-2027 current" with 302 children still enrolled only in 2025-2026, who
 * would then have vanished from every screen of the new year (migration 0276).
 *
 * `academics_year_end()` measures; this module turns the measurement into
 * sentences. No imports on purpose: it is read by a client component, and one
 * `import { z }` would ship the schema library to draw a checklist.
 */

export type YearEnd = {
  from: { id: string; name: string; endDate: string } | null;
  to: { id: string; name: string; startDate: string; isCurrent: boolean } | null;
  classes: { from: number; to: number };
  fees: { from: number; to: number };
  children: { waiting: number; moved: number; draftRun: string | null };
  renewals: { transport: number; hostel: number };
};

export type StepKey = "classes" | "fees" | "promote" | "renew" | "switch";

/**
 * `later` is a step that cannot be judged yet: seats and beds follow children,
 * so before anybody is promoted there is nothing to count, and "0 to renew"
 * would read as done when it means "not started".
 */
export type StepState = "done" | "todo" | "later";

export type Step = { key: StepKey; state: StepState; title: string; detail: string };

function count(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Defensive, because this is a jsonb document and a missing key must not throw. */
export function parseYearEnd(value: unknown): YearEnd | null {
  const v = record(value);
  const from = record(v.from);
  const to = record(v.to);
  if (!text(to.id)) return null;
  const classes = record(v.classes);
  const fees = record(v.fees);
  const children = record(v.children);
  const renewals = record(v.renewals);
  return {
    from: text(from.id)
      ? { id: text(from.id), name: text(from.name), endDate: text(from.endDate) }
      : null,
    to: {
      id: text(to.id),
      name: text(to.name),
      startDate: text(to.startDate),
      isCurrent: to.isCurrent === true,
    },
    classes: { from: count(classes.from), to: count(classes.to) },
    fees: { from: count(fees.from), to: count(fees.to) },
    children: {
      waiting: count(children.waiting),
      moved: count(children.moved),
      draftRun: text(children.draftRun) || null,
    },
    renewals: { transport: count(renewals.transport), hostel: count(renewals.hostel) },
  };
}

/** Both forms carried, never a stem and a rule: English plurals are not derivable. */
function n(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

export function yearEndSteps(y: YearEnd): Step[] {
  const from = y.from?.name ?? "this year";
  const to = y.to?.name ?? "next year";
  const steps: Step[] = [];

  steps.push(
    y.classes.to > 0
      ? {
          key: "classes",
          state: "done",
          title: `Classes for ${to}`,
          detail: `${n(y.classes.to, "class is", "classes are")} set up.`,
        }
      : {
          key: "classes",
          state: "todo",
          title: `Classes for ${to}`,
          detail:
            y.classes.from > 0
              ? `${to} has no classes yet, so there is nowhere to promote anybody into. Copy ${from}'s ${n(y.classes.from, "class", "classes")} across, then change any that differ.`
              : `${to} has no classes yet. Add them under Academics.`,
        },
  );

  steps.push(
    y.fees.to > 0
      ? {
          key: "fees",
          state: "done",
          title: `Fees for ${to}`,
          detail: `${n(y.fees.to, "fee is", "fees are")} set. Check the amounts under Fee setup once the year has changed, before the first invoice.`,
        }
      : {
          key: "fees",
          state: "todo",
          title: `Fees for ${to}`,
          detail:
            y.fees.from > 0
              ? `${to} has no fees yet, so its first invoice run would charge nothing. Copy ${from}'s ${n(y.fees.from, "fee", "fees")} across and edit what has changed.`
              : `${to} has no fees yet. Set them under Fee setup.`,
        },
  );

  const { waiting, moved, draftRun } = y.children;
  steps.push(
    waiting === 0
      ? {
          key: "promote",
          state: "done",
          title: "Promote the children",
          detail:
            moved > 0
              ? `${n(moved, "child is", "children are")} enrolled in ${to}.`
              : `Nobody is enrolled in ${from}, so there is nobody to move.`,
        }
      : {
          key: "promote",
          state: "todo",
          title: "Promote the children",
          detail:
            (draftRun
              ? `A draft run is waiting to be checked and applied. `
              : "") +
            `${n(waiting, "child", "children")} in ${from} ${waiting === 1 ? "has" : "have"} not been moved into ${to} yet. A run lets you promote, keep back or mark a child as leaving, one by one wherever the rules get it wrong.` +
            (moved > 0 ? ` ${n(moved, "child is", "children are")} already enrolled.` : ""),
        },
  );

  const toRenew = y.renewals.transport + y.renewals.hostel;
  const renewParts = [
    y.renewals.transport > 0 ? n(y.renewals.transport, "bus seat", "bus seats") : null,
    y.renewals.hostel > 0 ? n(y.renewals.hostel, "hostel bed", "hostel beds") : null,
  ].filter(Boolean);
  steps.push(
    moved === 0
      ? {
          key: "renew",
          state: "later",
          title: "Carry bus seats and hostel beds across",
          detail: "After promoting: a seat or a bed follows a child into the new year, so this is counted once children have moved.",
        }
      : toRenew > 0
        ? {
            key: "renew",
            state: "todo",
            title: "Carry bus seats and hostel beds across",
            detail: `${renewParts.join(" and ")} of promoted children ${toRenew === 1 ? "has" : "have"} not been carried into ${to}.`,
          }
        : {
            key: "renew",
            state: "done",
            title: "Carry bus seats and hostel beds across",
            detail: `Every seat and bed of a promoted child is carried into ${to}.`,
          },
  );

  steps.push(
    y.to?.isCurrent
      ? {
          key: "switch",
          state: "done",
          title: `Make ${to} the current year`,
          detail: `${to} is the current year.`,
        }
      : {
          key: "switch",
          state: "todo",
          title: `Make ${to} the current year`,
          detail:
            waiting > 0
              ? `Do this last. New registers, invoices and receipts are filed under the current year, and the ${n(waiting, "child", "children")} not yet promoted would disappear from ${to}'s screens.`
              : `New registers, invoices and receipts are then filed under ${to}. Unpaid ${from} fees stay on ${from}'s account and show as arrears.`,
        },
  );

  return steps;
}
