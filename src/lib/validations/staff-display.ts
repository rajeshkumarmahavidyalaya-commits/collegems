/**
 * Staff statuses and how they are rendered.
 *
 * Split out of `staff.ts` for the reason `fees-display.ts` was: a Zod schema
 * belongs in the browser when a form validates against it, and a label helper
 * does not. Importing this file must not charge a route 91 kB for Zod, so it
 * has **no imports at all** -- add one and it silently becomes the thing it
 * was extracted from.
 */

/**
 * The five words `staff_status_check` allows. A retirement and a dismissal are
 * not the same fact -- they read differently on a reference and are treated
 * differently in law in several jurisdictions -- so the CHECK carries all five
 * and this list mirrors it.
 */
export const STAFF_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "resigned", label: "Resigned" },
  { value: "retired", label: "Retired" },
  { value: "terminated", label: "Terminated" },
] as const;

/** The four somebody can *leave* as. `active` is not one of them. */
export const STAFF_LEAVING_STATUSES = STAFF_STATUSES.filter((s) => s.value !== "active");

export function staffStatusLabel(status: string): string {
  return STAFF_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/**
 * Badge tone. The badge always carries its label as text; the tone is never
 * the only signal.
 */
export function staffStatusTone(status: string): "success" | "secondary" | "warning" | "default" {
  if (status === "active") return "success";
  if (status === "retired") return "secondary";
  if (status === "inactive") return "warning";
  return "default";
}
