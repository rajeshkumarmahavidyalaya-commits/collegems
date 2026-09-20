/**
 * Seating: the display half.
 *
 * **This module has no imports and must keep none.** It is the `fees-display`
 * split: one `import { z }` here and every route that renders a status badge
 * pays 91 kB for Zod it does not use. The seating screens are Server
 * Components with one small client island, so the island is the only thing that
 * should ever reach for this.
 *
 * Nothing here is a gate. What a person may *do* is `hasPermission`, and which
 * rows they see is the policy.
 */

export type PlanStatus = "draft" | "published" | "discarded";

/** Wording, per status. Kept beside the tone so the two cannot drift. */
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  published: "Published",
  discarded: "Discarded",
};

export function planStatusTone(status: string): "default" | "success" | "secondary" {
  if (status === "published") return "success";
  if (status === "discarded") return "secondary";
  return "default";
}

export function severityTone(severity: string): "destructive" | "warning" | "secondary" {
  if (severity === "error") return "destructive";
  if (severity === "warning") return "warning";
  return "secondary";
}

/**
 * How a sitting's state reads on the list, and why it is three states rather
 * than a nullable plan id.
 *
 * *"No plan yet"* and *"a draft nobody has agreed"* are different jobs for the
 * office, and *"published"* is finished. Collapsing the first two into "not
 * published" is the shape this codebase already refused for a register, where
 * "0% present" and "nobody took it" look identical on a card and mean opposite
 * things.
 */
export type SittingState = "none" | "draft" | "published";

export function sittingState(planStatus: string | null): SittingState {
  if (planStatus === "published") return "published";
  if (planStatus === "draft") return "draft";
  return "none";
}

/**
 * Group a flat chart into rooms, preserving seat order.
 *
 * The rows arrive ordered by room and seat — `exam_seat_chart` says so and its
 * ORDER BY is part of the contract — so this only has to cut, never to sort.
 */
export function byRoom<T extends { roomName: string; roomId: string }>(
  rows: T[],
): { roomId: string; roomName: string; seats: T[] }[] {
  const out: { roomId: string; roomName: string; seats: T[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.roomId === row.roomId) last.seats.push(row);
    else out.push({ roomId: row.roomId, roomName: row.roomName, seats: [row] });
  }
  return out;
}

/**
 * A one-line description of the rules a plan was generated under.
 *
 * Read from the plan's own frozen copy, never from the tenant's current
 * setting: the whole point of freezing them is that a plan says what it was
 * made under, and a screen that re-read the setting would show today's answer
 * beside last week's arrangement.
 */
export function describeRules(rules: Record<string, unknown>): string {
  const fill = rules.fill === "pack" ? "filling each room before opening the next" : "spread evenly over the rooms";
  const order =
    rules.order === "admission" ? "admission number" : rules.order === "name" ? "name" : "roll number";
  const separate = rules.separate_same_paper === false;
  const reserve = typeof rules.reserve_per_room === "number" ? rules.reserve_per_room : 0;

  const parts = [`Candidates in ${order} order, ${fill}`];
  parts.push(
    separate
      ? "candidates writing the same paper may sit together"
      : "no two candidates writing the same paper sit together",
  );
  if (reserve > 0) parts.push(`${reserve} seat${reserve === 1 ? "" : "s"} held back in each room`);
  return parts.join(" · ");
}
