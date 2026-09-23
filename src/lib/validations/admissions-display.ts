/**
 * What the public application form needs in the browser, and nothing else.
 *
 * **This file has no imports, and must keep none.** The form is the one page a
 * person reaches without an account, often on a phone, often on a slow
 * connection; `admissions.ts` beside it begins `import { z }`, and one import
 * from there would ship Zod to every applicant to draw a `maxLength`. The
 * `fees-display.ts` warning, verbatim: one `import { z }` and it silently
 * becomes the thing it was extracted from.
 */

/** The bounds `admission_apply` enforces, for `maxLength` and nothing more. */
export const ADMISSION_LIMITS = {
  name: 80,
  contactName: 120,
  relationship: 40,
  notes: 1000,
  email: 200,
} as const;

export const ADMISSION_GENDERS = ["male", "female", "other", "undisclosed"] as const;

/**
 * The name of the field no person fills in.
 *
 * Hidden from sight and from assistive technology, and skipped by the tab
 * order, so the only thing that types into it is a script filling every input
 * it finds. **It is a courtesy, not a bound.** `admission_apply` holds each
 * college to its hourly limit under an advisory lock whether or not this field
 * exists, and a script that reads the page will leave it empty. It stops the
 * cheapest bots spending a college's hour, which is the whole of its job.
 */
export const HONEYPOT_FIELD = "company_website";
