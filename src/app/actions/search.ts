"use server";

import { createClient } from "@/lib/supabase/server";
import { isSearchKind, type SearchHit } from "@/lib/validations/search-display";

export type { SearchHit } from "@/lib/validations/search-display";

/**
 * Students, colleagues and books matching one term, for the command palette.
 *
 * ## It used to be five round trips and three filter strings
 *
 * Each keystroke fired five PostgREST requests, three of which built a filter
 * **language** out of somebody's typing:
 *
 *   .or(`first_name.ilike.${like},last_name.ilike.${like}`, { referencedTable: "people" })
 *
 * Migration `0223` replaced exactly this shape once, in the sibling picker, and
 * wrote down why — *the fix is not to escape more carefully, it is to stop
 * building a query out of text.* It fixed one of nine; these were three more.
 * `global_search` (migration `0258`) takes the term as a **bound parameter**
 * and answers in one round trip. Probed: a book called `Gödel, Escher, Bach`
 * is found by searching for `Escher, Bach`, which is the term that closes the
 * `or(` group early.
 *
 * ## There is no audience logic here, deliberately
 *
 * The function is `SECURITY INVOKER`, so the policies decide. Probed as a
 * guardian with one child on record, against an administrator on the same term
 * and the same day: **1 student, 0 staff, 10 books** against **20, 7, 10**. A
 * palette that filtered by role would be a second answer to a question Postgres
 * already answers — and the *first* answer is the only one that is a boundary.
 */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  // The floor is in the function too; this saves the round trip.
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("global_search", { p_query: q, p_limit: 5 });
  if (error) throw new Error(error.message);

  return (data ?? []).flatMap((row) =>
    // A kind the client does not know how to route is dropped rather than
    // rendered as a dead item: the projection and the renderer live in
    // different files and are free to drift.
    isSearchKind(row.kind)
      ? [{ kind: row.kind, id: row.id, title: row.title, reference: row.reference }]
      : [],
  );
}
