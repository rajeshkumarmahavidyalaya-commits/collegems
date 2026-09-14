import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";
/**
 * The school-health critics, browser half.
 *
 * `checks_run()` returns one row per problem, plus a single row for each check
 * that had nothing to say (`ok`), that the caller's role does not cover
 * (`withheld`), or that raised (`error`). Grouping is done here so the page can
 * say the three different sentences those states deserve — which is the whole
 * point of the server distinguishing them (CLAUDE.md rule 11).
 */

export type CheckRow = {
  key: string;
  label: string;
  description: string;
  module: string;
  href: string;
  status: string;
  severity: string | null;
  message: string | null;
};

export type CheckGroup = {
  key: string;
  label: string;
  description: string;
  module: string;
  href: string;
  status: "attention" | "ok" | "withheld" | "error";
  problems: { severity: string; message: string }[];
};

export function groupChecks(rows: CheckRow[]): CheckGroup[] {
  const byKey = new Map<string, CheckGroup>();

  for (const row of rows) {
    let group = byKey.get(row.key);
    if (!group) {
      group = {
        key: row.key,
        label: row.label,
        description: row.description,
        module: row.module,
        href: row.href,
        status: "ok",
        problems: [],
      };
      byKey.set(row.key, group);
    }

    if (row.status === "withheld") {
      group.status = "withheld";
      continue;
    }
    if (row.status === "ok") {
      // Leave it as `ok`; a check cannot be both clean and dirty.
      continue;
    }

    // `error` outranks `attention`: a check that could not run has not passed,
    // and a page that showed it among ordinary findings would let a broken
    // critic look like a working one with two complaints.
    if (row.status === "error") group.status = "error";
    else if (group.status !== "error") group.status = "attention";

    if (row.message) {
      group.problems.push({ severity: row.severity ?? "warning", message: row.message });
    }
  }

  return [...byKey.values()];
}

/** How many things actually need doing — errors included, clean checks not. */
export function attentionCount(groups: CheckGroup[]): number {
  return groups
    .filter((g) => g.status === "attention" || g.status === "error")
    .reduce((sum, g) => sum + g.problems.length, 0);
}

export function checkTone(
  status: CheckGroup["status"],
): "destructive" | "warning" | "success" | "secondary" {
  if (status === "error") return "destructive";
  if (status === "attention") return "warning";
  if (status === "ok") return "success";
  return "secondary";
}

/**
 * The four states a check can be in, in the reader's language.
 *
 * `skipped` is the fallback branch rather than a fourth comparison, which is
 * how it was written: anything that is not error/attention/ok is a check the
 * caller's role does not run. Naming the key `skipped` rather than
 * `notYourRole` keeps the catalogue keyed on the state, not on the sentence —
 * so a college that renames the message does not rename the concept.
 */
export function checkStatusLabel(status: CheckGroup["status"], t: Translator): string {
  if (status === "error") return labelFor("checks.status.error", "Could not run", t);
  if (status === "attention") return labelFor("checks.status.attention", "Needs attention", t);
  if (status === "ok") return labelFor("checks.status.ok", "Nothing to report", t);
  return labelFor("checks.status.skipped", "Not your role", t);
}

/**
 * Severity within a check. `error` is the runner's own, not a critic's — a
 * critic only ever says `warning` or `info`.
 */
export function severityTone(severity: string): "destructive" | "warning" | "secondary" {
  if (severity === "error") return "destructive";
  return severity === "warning" ? "warning" : "secondary";
}
