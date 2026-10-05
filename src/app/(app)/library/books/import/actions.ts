"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bookImportRowSchema } from "@/lib/validations/library";
import { MAX_BOOK_IMPORT_ROWS } from "@/lib/validations/book-import";
import type { ActionResult } from "../../actions";

export type BookImportOutcome = {
  line: number;
  title: string;
  ok: boolean;
  /** The new book's id when it went in; the sentence when it did not. */
  id?: string;
  error?: string;
};

/**
 * Adds the checked rows through `library_import_books` (0339): one call, each
 * row in its own sub-transaction, one outcome per row. The function is
 * SECURITY INVOKER, so the `books` policy decides who may add books, exactly
 * as for the one-book form; nothing here is a second gate.
 *
 * **Partial, and says so** (rule 13): a row this boundary refuses is reported
 * beside the ones the function refused, and the rest go in.
 */
export async function importBookRows(
  input: unknown[],
): Promise<ActionResult<{ added: number; outcomes: BookImportOutcome[] }>> {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "There is nothing to import." };
  }
  if (input.length > MAX_BOOK_IMPORT_ROWS) {
    return {
      ok: false,
      error: `One import takes at most ${MAX_BOOK_IMPORT_ROWS} books and this is ${input.length}. Split the file.`,
    };
  }

  const outcomes: BookImportOutcome[] = [];
  const rows: Record<string, string | number>[] = [];
  input.forEach((raw, index) => {
    const parsed = bookImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      const line = (raw as { line?: number })?.line ?? index + 1;
      const first = Object.values(parsed.error.flatten().fieldErrors).flat()[0];
      outcomes.push({
        line,
        title: String((raw as { title?: unknown })?.title ?? ""),
        ok: false,
        error: first ?? "This row is not complete.",
      });
      return;
    }
    const v = parsed.data;
    rows.push({
      line: v.line,
      title: v.title,
      author: v.author,
      subject: v.subject,
      book_number: v.bookNumber,
      isbn: v.isbn,
      rack: v.rack,
      price: v.price === null ? "" : String(v.price),
      quantity: String(v.quantity),
      publisher: v.publisher,
      edition: v.edition,
    });
  });

  if (rows.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("library_import_books", { p_rows: rows });
    if (error) return { ok: false, error: error.message };
    for (const o of (data ?? []) as {
      line: number;
      title?: string;
      ok: boolean;
      id?: string;
      error?: string;
    }[]) {
      outcomes.push({ line: o.line, title: o.title ?? "", ok: o.ok, id: o.id, error: o.error });
    }
  }

  const added = outcomes.filter((o) => o.ok).length;
  if (added > 0) revalidatePath("/library/books");
  return { ok: true, data: { added, outcomes: outcomes.sort((a, b) => a.line - b.line) } };
}
