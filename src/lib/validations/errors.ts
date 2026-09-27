/**
 * What a failed delete says to the person who pressed the button.
 *
 * No imports, deliberately: a client component may want the same wording, and
 * one `import { z }` here would charge every importer for Zod (the
 * `fees-display.ts` split).
 *
 * Three cases, and the order matters:
 *
 * - **P0001** is one of this product's own guards (`0288`, `0289`). It already
 *   speaks in a sentence naming what is held, so it passes through untouched --
 *   rewording it would lose the count.
 * - **23503** is a foreign key refusing. Postgres names the constraint, which
 *   nobody at a school can read, so this names the kind of record still
 *   pointing at it instead.
 * - **42501** is a policy or privilege refusing.
 *
 * Anything else keeps its message behind a plain first clause, because an
 * unknown failure with its detail removed is one nobody can report.
 */
export type DbError = { code?: string | null; message: string };

/** `"ledger_entries"` -> `"ledger entries"`: the referencing table, readable. */
function tableWords(message: string): string | null {
  const tables = [...message.matchAll(/on table "([a-z_]+)"/g)].map((m) => m[1]);
  // "update or delete on table "books" violates ... on table "book_issues"":
  // the last one named is the table still holding a reference.
  const holder = tables.at(-1);
  return holder ? holder.replace(/_/g, " ") : null;
}

export function deleteErrorSentence(error: DbError, what: string): string {
  if (error.code === "P0001") return error.message;
  if (error.code === "23503") {
    const holder = tableWords(error.message);
    return holder
      ? `${capitalise(what)} cannot be deleted: records in ${holder} still refer to it.`
      : `${capitalise(what)} cannot be deleted: other records still refer to it.`;
  }
  if (error.code === "42501") return `Your role may not delete ${what}.`;
  return `Could not delete ${what}. ${error.message}`;
}

/**
 * A delete that no policy matches raises nothing and removes nothing (rule 6),
 * so a caller that only checks `error` reports a success that did not happen.
 */
export function nothingDeletedSentence(what: string): string {
  return `Nothing was deleted: ${what} is no longer here, or your role may not delete it.`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
