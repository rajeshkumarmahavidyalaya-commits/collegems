/**
 * When a bus seat or a hostel bed is *current*.
 *
 * This module has no imports on purpose. The rule it holds is the one migration
 * `0203` was written to fix, and it needs to be assertable without a database —
 * a guard that can only run against a live Supabase project is a guard that
 * does not run.
 *
 * The history behind it, because the shape recurs:
 *
 * `transport_for_student` and `hostel_for_student` return every arrangement a
 * child has ever had. `mobile_student_card` took the first row and re-exported
 * `status` from it, so a guardian's phone showed `"status": "active"` beside
 * `"effective_ends_on": "2026-03-31"` — 162 days after the seat ended, to 88
 * families. Rule 2 named the two mistakes:
 *
 *   * **`limit 1` over a history is "the latest", not "the current one"**;
 *   * **the card had a date and never used it.**
 *
 * So: the status column alone never decides this, and neither does position in
 * the list. The date does.
 */

export type DatedArrangement = {
  status: string;
  starts_on: string;
  /**
   * The generated column rule 2's boundary device added — the arrangement's own
   * session end, carried on the child. Read this rather than `ends_on`: a null
   * `ends_on` means "to the end of the year this was made for", not "for ever",
   * and `effective_ends_on` is where that resolution lives.
   */
  effective_ends_on: string | null;
};

/**
 * Both halves are load-bearing.
 *
 * A cancelled row is not current however its dates read; and an `active` row
 * whose year has ended is exactly the case that shipped to production. Dates
 * are ISO `YYYY-MM-DD`, so string comparison is date comparison — no `Date`
 * object is constructed, and therefore no timezone can shift the answer by a
 * day (rule 11's instinct about `report_day_bounds`, one layer up).
 */
export function isCurrentArrangement(row: DatedArrangement, today: string): boolean {
  if (row.status !== "active") return false;
  if (row.starts_on > today) return false;
  // Genuinely open-ended: the boundary device leaves this null only when the
  // row carries no session dates at all.
  return row.effective_ends_on === null || row.effective_ends_on >= today;
}

/**
 * Finished, and therefore worth showing as history rather than hiding.
 *
 * A family checking an old invoice needs to see that the seat ran until March.
 * A screen that drops finished arrangements is how somebody concludes the
 * school lost the record.
 */
export function hasEndedBefore(row: DatedArrangement, today: string): boolean {
  return (
    !isCurrentArrangement(row, today) &&
    row.effective_ends_on !== null &&
    row.effective_ends_on < today
  );
}
