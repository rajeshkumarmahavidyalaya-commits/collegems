"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Loader2, SendHorizontal, Sparkles, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  cellText,
  tableToCsv,
  type AssistantTable,
  type AssistantTurn,
} from "@/lib/validations/assistant";
import { askAssistant } from "./actions";

type Message =
  | { role: "user"; text: string }
  | { role: "model"; text: string; tables: AssistantTable[] }
  | { role: "error"; text: string };

/** Rows drawn on screen per table; the download carries all of them. */
const PREVIEW_ROWS = 25;

/**
 * **bold** and "* " / "- " bullets, which is all the model is asked to use,
 * rendered as elements -- never as HTML, so nothing in an answer (or in the
 * data it quotes) can inject markup into the page.
 */
function Rich({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[*-]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const content = bullet ? line.replace(/^\s*[*-]\s+/, "") : line;
    if (last && last.list === bullet && (bullet || last.lines.length)) last.lines.push(content);
    else blocks.push({ list: bullet, lines: [content] });
  }
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  return (
    <div className="flex flex-col gap-2">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            <ul key={i} className="list-disc ps-5">
              {b.lines.map((l, j) => (
                <li key={j}>{inline(l)}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}</p>
          ),
        )}
    </div>
  );
}

function ResultTable({ table }: { table: AssistantTable }) {
  function download() {
    const blob = new Blob([tableToCsv(table)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.title.replace(/[^\w-]+/g, "-").toLowerCase() || "result"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shown = table.rows.slice(0, PREVIEW_ROWS);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Table2 className="size-4 text-muted-foreground" aria-hidden="true" />
          {table.title}
          <span className="font-normal text-muted-foreground">
            · {table.total} {table.total === 1 ? "row" : "rows"}
          </span>
        </p>
        <div className="flex gap-2">
          {table.rows.length > 0 && (
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="size-4" aria-hidden="true" />
              Download CSV
            </Button>
          )}
          {table.reportKey && (
            <Button size="sm" variant="ghost" asChild>
              <Link href="/reports">Open in Reports</Link>
            </Button>
          )}
        </div>
      </div>
      {table.rows.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">Nothing matched.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr>
                {table.columns.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2 text-start font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                <tr key={i} className="border-t border-border">
                  {table.columns.map((c) => (
                    <td key={c.key} className="px-3 py-1.5 align-top">
                      {cellText(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(table.rows.length > PREVIEW_ROWS || table.total > table.rows.length) && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Showing {shown.length} here. The download has {table.rows.length}
          {table.total > table.rows.length ? ` of ${table.total}; Reports exports the rest` : ""}.
        </p>
      )}
    </div>
  );
}

export function AssistantChat({
  suggestions,
  greeting,
}: {
  suggestions: string[];
  greeting: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  function ask(question: string) {
    const text = question.trim();
    if (!text || pending) return;
    const next: Message[] = [...messages, { role: "user", text }];
    setMessages(next);
    setDraft("");
    // Only the words of the conversation travel back: the model re-reads
    // tables with its tools rather than trusting a copy held in the browser.
    const turns: AssistantTurn[] = next
      .filter((m): m is Exclude<Message, { role: "error" }> => m.role !== "error")
      .map((m) => ({ role: m.role, text: m.text }));
    startTransition(async () => {
      const r = await askAssistant(turns);
      if (!r.ok) {
        setMessages((m) => [...m, { role: "error", text: r.error }]);
        return;
      }
      setRemaining(r.data.remaining);
      setMessages((m) => [...m, { role: "model", text: r.data.answer, tables: r.data.tables }]);
    });
  }

  return (
    <Card className="flex min-h-[60vh] flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 pt-6">
        <div className="flex flex-1 flex-col gap-4" aria-live="polite" aria-busy={pending}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-6" aria-hidden="true" />
              </span>
              <div>
                <p className="text-lg font-semibold">{greeting}</p>
                <p className="text-sm text-muted-foreground">
                  Ask in English, Hindi or Urdu. Answers come from the records your login can see.
                </p>
              </div>
              <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-start" onClick={() => ask(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {m.text}
              </div>
            ) : m.role === "error" ? (
              <div key={i} role="alert" className="max-w-[85%] rounded-2xl border border-destructive/40 px-4 py-2 text-sm text-destructive">
                {m.text}
              </div>
            ) : (
              <div key={i} className="flex max-w-full flex-col gap-3 sm:max-w-[92%]">
                <div className="rounded-2xl rounded-es-sm bg-muted px-4 py-3 text-sm">
                  <Rich text={m.text} />
                </div>
                {m.tables.map((t, j) => (
                  <ResultTable key={j} table={t} />
                ))}
              </div>
            ),
          )}

          {pending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Looking it up…
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="flex flex-col gap-2 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <label htmlFor="assistant-question" className="sr-only">
            Your question
          </label>
          <div className="flex items-end gap-2">
            <Textarea
              id="assistant-question"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder="For example: who has not paid fees in Grade 6 A?"
              className="min-h-[44px] resize-none"
            />
            <Button type="submit" disabled={pending || !draft.trim()} aria-label="Ask">
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <SendHorizontal className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The assistant reads only; it cannot change anything. Questions are sent to Google Gemini to be understood,
            and each one is logged for the college.
            {remaining !== null && ` ${remaining} questions left today.`}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
