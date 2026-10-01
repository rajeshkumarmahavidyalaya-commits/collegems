"use client";

import { useMemo, useState, useTransition } from "react";
import { ROLL_FILE_ACCEPT, readRollFile } from "@/lib/import/read-file";
import Link from "next/link";
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_STAFF_IMPORT_ROWS,
  STAFF_IMPORT_COLUMNS,
  STAFF_IMPORT_TEMPLATE,
  judgeStaffRows,
  parseStaffCsv,
  toStaffPayload,
  type StaffImportField,
  type StaffImportRow,
} from "@/lib/validations/staff-import";
import { importStaffRows, type StaffImportOutcome } from "./actions";

/**
 * Read a file (or pasted text), show every row as editable cells with what is
 * wrong beside it, and add the rows that are ready. Rows that fail -- here or
 * in the database -- stay on the screen with their reason, so the office fixes
 * them and presses Add again rather than re-typing a spreadsheet (rule 13).
 */
/**
 * A spreadsheet copies as tab-separated text. Quote each cell rather than
 * swapping tabs for commas, because "Sharma, Anita" is one cell.
 */
function fromPaste(text: string): string {
  if (!text.includes("\t")) return text;
  return text
    .split(/\r\n|\n|\r/)
    .map((line) =>
      line
        .split("\t")
        .map((cell) => `"${cell.replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
}

export function StaffImportView() {
  const [rows, setRows] = useState<StaffImportRow[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Map<string, string>>(new Map());
  const [added, setAdded] = useState<StaffImportOutcome[]>([]);
  const [pending, startTransition] = useTransition();

  const problems = useMemo(() => judgeStaffRows(rows), [rows]);
  const ready = rows.filter((r) => (problems.get(r.key) ?? []).length === 0);

  function load(source: string) {
    setError(null);
    setNotice(null);
    setServerErrors(new Map());
    const parsed = parseStaffCsv(source);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setRows(parsed.rows);
    if (parsed.unmatched.length > 0) {
      setNotice(
        `Ignoring ${parsed.unmatched.length === 1 ? "1 column" : `${parsed.unmatched.length} columns`} this import does not use: ${parsed.unmatched.join(", ")}.`,
      );
    }
  }

  function edit(key: string, field: StaffImportField, value: string) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    setServerErrors((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  function remove(key: string) {
    setRows((current) => current.filter((r) => r.key !== key));
  }

  function apply() {
    const batch = ready;
    startTransition(async () => {
      const result = await importStaffRows(
        batch.map((r) => ({ line: r.line, values: toStaffPayload(r) })),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const byLine = new Map(result.data.outcomes.map((o) => [o.line, o]));
      const failed = new Map<string, string>();
      const done = new Set<string>();
      for (const r of batch) {
        const o = byLine.get(r.line);
        if (o?.ok) done.add(r.key);
        else if (o) failed.set(r.key, o.error ?? "Not added.");
      }
      setRows((current) => current.filter((r) => !done.has(r.key)));
      setServerErrors(failed);
      setAdded((current) => [...current, ...result.data.outcomes.filter((o) => o.ok)]);
      const left = failed.size;
      toast.success(
        `${result.data.added === 1 ? "1 person" : `${result.data.added} people`} added.${
          left > 0 ? ` ${left === 1 ? "1 row was" : `${left} rows were`} not -- the reason is on each.` : ""
        }`,
      );
    });
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(STAFF_IMPORT_TEMPLATE)}`;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. The file</CardTitle>
          <CardDescription className="max-w-2xl">
            A CSV with a heading row, or the same pasted from a spreadsheet. At most{" "}
            {MAX_STAFF_IMPORT_ROWS} people -- a longer file is refused rather than cut short. Needed:{" "}
            {STAFF_IMPORT_COLUMNS.filter((c) => c.required)
              .map((c) => c.label.toLowerCase())
              .join(", ")}
            . Dates may be written 2024-06-12 or 12/06/2024 (day first).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staff-import-file">File</Label>
              <Input
                id="staff-import-file"
                type="file"
                accept={ROLL_FILE_ACCEPT}
                className="max-w-xs cursor-pointer"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const read = await readRollFile(file);
                  if (read.ok) load(read.text);
                  else setError(read.error);
                }}
              />
            </div>
            <Button asChild variant="outline">
              <a href={templateHref} download="staff-import-template.csv">
                <Download className="size-4" aria-hidden="true" />
                Template
              </a>
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-import-paste">…or paste it here</Label>
            <Textarea
              id="staff-import-paste"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={STAFF_IMPORT_COLUMNS.map((c) => c.label).join(",")}
              className="font-mono text-xs"
            />
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={text.trim() === ""}
                onClick={() => load(fromPaste(text))}
              >
                <Upload className="size-4" aria-hidden="true" />
                Read pasted text
              </Button>
            </div>
          </div>
          <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {notice}
          </p>
          <p aria-live="assertive" className="min-h-5">
            {error && (
              <span role="alert" className="text-sm font-medium text-destructive">
                {error}
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Check every row</CardTitle>
            <CardDescription>
              {ready.length} of {rows.length} ready. Fix a cell in place, or remove a row that
              should not be here. Only the ready rows are added.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[1400px] text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-start font-medium">Line</th>
                    {STAFF_IMPORT_COLUMNS.map((c) => (
                      <th key={c.field} scope="col" className="px-2 py-2 text-start font-medium">
                        {c.label}
                        {c.required && <span aria-hidden="true"> *</span>}
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    return (
                      <tr key={r.key} className="border-t align-top">
                        <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                          {r.line}
                        </td>
                        {STAFF_IMPORT_COLUMNS.map((c) => (
                          <td key={c.field} className="px-1 py-1">
                            <Input
                              value={r[c.field]}
                              onChange={(e) => edit(r.key, c.field, e.target.value)}
                              aria-label={`${c.label}, line ${r.line}`}
                              aria-invalid={c.required && r[c.field].trim() === "" ? true : undefined}
                              className="h-8 min-w-24"
                            />
                          </td>
                        ))}
                        <td className="px-1 py-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove line ${r.line}`}
                            onClick={() => remove(r.key)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
              {rows.flatMap((r) => {
                const list = [
                  ...(problems.get(r.key) ?? []),
                  ...(serverErrors.has(r.key) ? [serverErrors.get(r.key) as string] : []),
                ];
                return list.length === 0
                  ? []
                  : [
                      <li key={r.key} className="text-destructive">
                        <span className="font-medium">Line {r.line}:</span> {list.join("; ")}.
                      </li>,
                    ];
              })}
            </ul>

            <div>
              <Button type="button" disabled={pending || ready.length === 0} onClick={apply}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Add {ready.length === 1 ? "1 person" : `${ready.length} people`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {added.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Added</CardTitle>
            <CardDescription>
              {added.length === 1 ? "1 person is" : `${added.length} people are`} now on the staff.
              A login is given from each record, or all at once from Settings, Team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {added.map((o) => (
                <li key={o.id}>
                  <Link href={`/staff/${o.id}`} className="underline underline-offset-2">
                    {o.name}
                  </Link>{" "}
                  <span className="font-mono text-xs text-muted-foreground">{o.employeeCode}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
