/**
 * The assistant's reply, and the questions each kind of person is offered
 * (migration 0283, `supabase/functions/assistant`).
 *
 * No imports on purpose: the chat is a client component, and one `import { z }`
 * would ship the schema library to draw a conversation.
 */

export type AssistantTurn = { role: "user" | "model"; text: string };

export type AssistantColumn = { key: string; label: string };

export type AssistantTable = {
  title: string;
  columns: AssistantColumn[];
  rows: Record<string, unknown>[];
  total: number;
  reportKey: string | null;
};

export type AssistantReply = {
  answer: string;
  tables: AssistantTable[];
  remaining: number | null;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Defensive, because it comes over the wire from an Edge Function. */
export function parseAssistantReply(value: unknown): AssistantReply {
  const v = record(value);
  const tables = Array.isArray(v.tables) ? v.tables : [];
  return {
    answer: typeof v.answer === "string" ? v.answer : "",
    remaining: typeof v.remaining === "number" ? v.remaining : null,
    tables: tables.map((raw) => {
      const t = record(raw);
      const rows = Array.isArray(t.rows) ? t.rows.map(record) : [];
      const declared = Array.isArray(t.columns)
        ? t.columns
            .map(record)
            .filter((c) => typeof c.key === "string")
            .map((c) => ({ key: c.key as string, label: typeof c.label === "string" ? c.label : (c.key as string) }))
        : [];
      return {
        title: typeof t.title === "string" ? t.title : "Result",
        // The id columns travel in the row for links and are declared in no
        // column (rule 11), so a table with declared columns shows only those.
        columns: declared.length
          ? declared
          : Object.keys(rows[0] ?? {}).map((key) => ({ key, label: key.replace(/_/g, " ") })),
        rows,
        total: typeof t.total === "number" ? t.total : rows.length,
        reportKey: typeof t.reportKey === "string" ? t.reportKey : null,
      };
    }),
  };
}

/** A cell as text, for the table and the download alike. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Questions to start from, by who is asking. Each is answerable by that seat's
 * own reports -- a suggestion that gets "your role does not include that" is
 * worse than none.
 */
export const SUGGESTIONS: Record<"principal" | "staff" | "student" | "family", string[]> = {
  principal: [
    "Give me today's summary of the college",
    "Who owes the most fees? Show the top 10",
    "How much fee was collected this month?",
    "Which classes have registers that were never taken this week?",
    "What needs my attention right now?",
    "Show the class roster for Grade 6 A",
  ],
  staff: [
    "Give me today's summary",
    "Show the class roster for my class",
    "Which books are overdue?",
    "What is my teaching load this week?",
  ],
  student: [
    "What are my subjects this year?",
    "How is my attendance?",
    "How much fee do I still owe?",
    "Show my latest results",
  ],
  family: [
    "How is my child's attendance?",
    "How much fee is still due?",
    "Show my child's latest results",
    "What subjects is my child taking this year?",
  ],
};

export function suggestionsFor(tier: string | null | undefined, subject?: string | null): string[] {
  if (tier === "principal") return SUGGESTIONS.principal;
  // A parent shares the student tier and asks about somebody else (0224).
  if (tier === "student") return subject === "guardian" ? SUGGESTIONS.family : SUGGESTIONS.student;
  return SUGGESTIONS.staff;
}

/**
 * A table as CSV text, for the download button. Written here rather than
 * imported from the DataTable module, which would bring TanStack Table into the
 * chat's bundle to join some strings. A leading BOM so Excel opens Hindi and
 * the rupee sign correctly; cells starting with = + - @ are prefixed so a
 * spreadsheet does not run them as formulas.
 */
export function tableToCsv(table: Pick<AssistantTable, "columns" | "rows">): string {
  const quote = (value: unknown) => {
    let s = cellText(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = table.columns.map((c) => quote(c.label)).join(",");
  const lines = table.rows.map((row) => table.columns.map((c) => quote(row[c.key])).join(","));
  return "\uFEFF" + [header, ...lines].join("\r\n");
}
