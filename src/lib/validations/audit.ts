import { z } from "zod";

/**
 * The audit trail — the client half.
 *
 * `audit_log` is a copy of every row in every table, so the judgements that
 * matter are all in Postgres: an admin-only policy (migration 0008), the
 * `audit.view` permission beside it (0164), and the diff itself (0163). This
 * file only turns what comes back into sentences.
 */

export const AUDIT_ACTIONS = ["insert", "update", "delete"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Said from the reader's side, not the database's. Somebody asking what
 * happened to a certificate is not thinking in DML.
 */
export const ACTION_LABEL: Record<AuditAction, string> = {
  insert: "Created",
  update: "Edited",
  delete: "Deleted",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action as AuditAction] ?? action;
}

/** Never colour alone — `actionLabel` always sits beside this. */
export function actionTone(action: string): "success" | "secondary" | "destructive" {
  switch (action) {
    case "insert":
      return "success";
    case "delete":
      return "destructive";
    default:
      return "secondary";
  }
}

/**
 * A column name, made readable without being made dishonest.
 *
 * `substitute_staff_id` becomes "Substitute staff id" and **keeps the id**.
 * Dropping the suffix would read as "Substitute staff: 8f3c…" — a label
 * promising a name next to a value that is plainly not one. The suffix is the
 * warning that what follows is a key.
 */
export function fieldLabel(field: string): string {
  const spaced = field.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const EMPTY_VALUE = "—";

/**
 * One side of a diff, rendered.
 *
 * A foreign key shows as a uuid and stays that way. Resolving it would mean a
 * generic function joining to an arbitrary table — and the log outlives the row
 * it describes, which is most of the point of keeping it, so the join would
 * often find nothing and the reader would be told "unknown" about a record that
 * definitely existed. Showing the key is the honest answer.
 */
export function formatAuditValue(value: unknown, maxLength = 120): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);

  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === "") return EMPTY_VALUE;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export const auditChangeSchema = z.object({
  from: z.unknown().nullable().optional(),
  to: z.unknown().nullable().optional(),
});

/** `{field: {from, to}}` as Postgres returns it, parsed defensively. */
export function parseChangedFields(raw: unknown): { field: string; from: unknown; to: unknown }[] {
  const result = z.record(z.string(), auditChangeSchema).safeParse(raw);
  if (!result.success) return [];
  return Object.entries(result.data)
    .map(([field, change]) => ({ field, from: change.from ?? null, to: change.to ?? null }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * The one-line summary of an entry.
 *
 * The case that matters is **an update with nothing in it**. Every table here
 * has a `set_updated_at` trigger, so a write that changed no real column still
 * makes an audit row, and `audit_changed_fields` correctly returns `{}` for it.
 * Rendering that as "Edited · 0 fields" invites the reader to hunt for a change
 * that is not there, so it gets its own sentence.
 */
export function entrySummary(entry: { action: string; fieldCount: number }): string {
  if (entry.action === "insert") return "Created";
  if (entry.action === "delete") return "Deleted";
  if (entry.fieldCount === 0) return "Saved with no changes";
  return entry.fieldCount === 1 ? "1 field changed" : `${entry.fieldCount} fields changed`;
}

/**
 * "System" and "Deleted login" are the two ways `audit_log` cannot name a
 * person, and Postgres already distinguishes them (migration 0163). This is
 * only whether to render the value as a name or as a state.
 */
export function actorIsPerson(actor: string): boolean {
  return actor !== "System" && actor !== "Deleted login";
}
