/**
 * What the command palette draws for a search hit.
 *
 * **No imports, on purpose.** The palette is a client component on every one of
 * the 94 authenticated pages, so anything this file pulls in is pulled onto all
 * of them — the `fees-display.ts` bargain, and its warning verbatim: one
 * `import { z }` and it silently becomes the thing it was extracted from. The
 * `Translator` below is a *type-only* import, which compiles away.
 */
import type { Translator } from "@/lib/i18n/translate";

export type SearchKind = "student" | "staff" | "book";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  /** The admission number, the designation, or the author — a value, never a sentence. */
  reference: string | null;
};

export const SEARCH_KINDS: readonly SearchKind[] = ["student", "staff", "book"] as const;

export function isSearchKind(value: string): value is SearchKind {
  return (SEARCH_KINDS as readonly string[]).includes(value);
}

/**
 * Where a hit goes.
 *
 * `global_search` deliberately returns no path: a route is a fact about this
 * application and not about the row, which is the same decision rule 11 made
 * from the other side when it put `href` on the report *catalogue* rather than
 * on the table. Keeping it here is also what fixed the defect this module was
 * written for — **every student and every member of staff in the palette linked
 * to `/library/members`**, so searching for a child by name took the office to
 * the library's membership list.
 *
 * There is no permission branch here and there must not be one: RLS decides
 * what `global_search` returns, so a guardian is only ever offered their own
 * children, and `/students/[id]` resolves that child by id through the same
 * policy. The menu is never the gate (rule 4) — and neither is the palette.
 */
export function searchHitHref(hit: SearchHit): string {
  switch (hit.kind) {
    case "student":
      return `/students/${hit.id}`;
    case "staff":
      return `/staff/${hit.id}`;
    case "book":
      return `/library/books/${hit.id}`;
  }
}

/**
 * The line under the name.
 *
 * A designation and an author are the school's own words and travel as they
 * are; an admission number needs a sentence around it, so that one goes
 * through the catalogue. Rule 15's rule about frames: *the sentence is the
 * unit, not the word.*
 */
export function searchHitSubtitle(hit: SearchHit, t: Translator): string {
  if (hit.kind === "student") {
    return hit.reference ? t("palette.admission", { number: hit.reference }) : "";
  }
  return hit.reference ?? "";
}
