"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Play, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applySentence,
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  parseCsv,
  rowStatus,
} from "@/lib/validations/import";
import {
  applyImport,
  discardImport,
  saveRow,
  setSkipped,
  stageImport,
  type ImportRowRow,
  type ImportRunRow,
  type ImportSummary,
} from "./actions";

type Options = { id: string; label: string }[];

export function ImportView({
  run,
  rows,
  summary,
  past,
  sections,
  canPrepare,
  canApply,
}: {
  run: ImportRunRow | null;
  rows: ImportRowRow[];
  summary: ImportSummary;
  past: ImportRunRow[];
  sections: Options;
  canPrepare: boolean;
  canApply: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {run === null ? (
        <>
          {canPrepare && <UploadCard />}
          <PastRuns past={past} />
        </>
      ) : (
        <RunEditor
          run={run}
          rows={rows}
          summary={summary}
          sections={sections}
          canApply={canApply}
        />
      )}
    </div>
  );
}

function UploadCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setNotice(null);

    const text = await file.text();
    const parsed = parseCsv(text);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.unmatched.length > 0) {
      setNotice(
        `Ignoring ${parsed.unmatched.length} column${parsed.unmatched.length === 1 ? "" : "s"} this import does not use: ${parsed.unmatched.join(", ")}.`,
      );
    }

    startTransition(async () => {
      const result = await stageImport(file.name, parsed.rows);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        `${parsed.rows.length} rows read, ${result.data.ready} ready to import.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a file</CardTitle>
        <CardDescription className="max-w-2xl">
          A CSV with a heading row. At most {MAX_IMPORT_ROWS} rows — a longer file is refused rather
          than truncated, because silently importing the first {MAX_IMPORT_ROWS} of nine hundred
          children is the worst possible outcome.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-file">File</Label>
          <Input
            id="import-file"
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="cursor-pointer"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <p aria-live="polite" className="min-h-5 text-sm">
            {pending && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Reading the file…
              </span>
            )}
            {notice && !pending && <span className="text-muted-foreground">{notice}</span>}
          </p>
          <p aria-live="assertive" className="min-h-5">
            {error && (
              <span role="alert" className="text-sm font-medium text-destructive">
                {error}
              </span>
            )}
          </p>
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-medium">Columns it understands</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Headings are matched loosely — &ldquo;Admission No.&rdquo; and{" "}
            <code className="font-mono">admission_number</code> both work. Only{" "}
            {IMPORT_COLUMNS.filter((c) => c.required)
              .map((c) => c.label.toLowerCase())
              .join(" and ")}{" "}
            are required.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.field}>
                <Badge variant={c.required ? "default" : "outline"} className="font-normal">
                  {c.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function RunEditor({
  run,
  rows,
  summary,
  sections,
  canApply,
}: {
  run: ImportRunRow;
  rows: ImportRowRow[];
  summary: ImportSummary;
  sections: Options;
  canApply: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);

  function toggleSkip(row: ImportRowRow) {
    setBusyRow(row.id);
    startTransition(async () => {
      const result = await setSkipped(run.id, row.id, !row.skipped);
      setBusyRow(null);
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });
  }

  function apply() {
    if (
      !window.confirm(
        `Import ${summary.ready} student${summary.ready === 1 ? "" : "s"}? This creates real records and cannot be undone from here.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await applyImport(run.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.failed === 0
          ? `${result.data.applied} students imported.`
          : `${result.data.applied} imported, ${result.data.failed} failed — their reasons are on the rows.`,
      );
      router.refresh();
    });
  }

  function discard() {
    if (!window.confirm("Discard this import? The rows are kept, but nothing will be written.")) {
      return;
    }
    startTransition(async () => {
      const result = await discardImport(run.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Discarded.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Rows in the file" value={String(summary.total)} />
        <Stat label="Ready" value={String(summary.ready)} />
        <Stat
          label="Need fixing"
          value={String(summary.withProblems)}
          tone={summary.withProblems > 0 ? "warn" : undefined}
        />
        <Stat label="Skipped" value={String(summary.skipped)} />
      </div>

      {summary.withProblems > 0 && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {summary.withProblems} row{summary.withProblems === 1 ? "" : "s"} need attention
          </AlertTitle>
          <AlertDescription>
            Correct them below and they are re-checked immediately — including against the rows you
            have already fixed, so a new duplicate is caught before importing rather than during it.
            Or skip a row to leave it out entirely.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{run.fileName ?? "Import"}</CardTitle>
            <CardDescription>
              {summary.total} rows read. Editing here does not touch the file.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={discard}
              className="cursor-pointer"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Discard
            </Button>
            {canApply && (
              <Button
                type="button"
                disabled={pending || summary.ready === 0}
                onClick={apply}
                className="cursor-pointer"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="size-4" aria-hidden="true" />
                )}
                {applySentence(summary)}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">Row</TableHead>
                  <TableHead>Child</TableHead>
                  <TableHead>Admission no.</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16 text-right">Skip</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <RowEditor
                    key={row.id}
                    runId={run.id}
                    row={row}
                    sections={sections}
                    busy={busyRow === row.id && pending}
                    onToggleSkip={() => toggleSkip(row)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RowEditor({
  runId,
  row,
  sections,
  busy,
  onToggleSkip,
}: {
  runId: string;
  row: ImportRowRow;
  sections: Options;
  busy: boolean;
  onToggleSkip: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    firstName: row.firstName ?? "",
    lastName: row.lastName ?? "",
    admissionNumber: row.admissionNumber ?? "",
    sectionId: row.sectionId ?? "",
  });

  const status = rowStatus(row);
  const dirty =
    draft.firstName !== (row.firstName ?? "") ||
    draft.lastName !== (row.lastName ?? "") ||
    draft.admissionNumber !== (row.admissionNumber ?? "") ||
    draft.sectionId !== (row.sectionId ?? "");

  function save() {
    startTransition(async () => {
      const result = await saveRow(runId, {
        id: row.id,
        firstName: draft.firstName,
        lastName: draft.lastName,
        admissionNumber: draft.admissionNumber,
        sectionId: draft.sectionId,
        dateOfBirth: row.dateOfBirth ?? "",
        gender: row.gender ?? "",
        rollNumber: row.rollNumber ?? "",
        guardianName: row.guardianName ?? "",
        guardianPhone: row.guardianPhone ?? "",
        skipped: row.skipped,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <TableRow className={row.skipped ? "opacity-60" : undefined}>
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {row.lineNumber}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Input
            aria-label={`First name, row ${row.lineNumber}`}
            className="h-8 w-28"
            value={draft.firstName}
            disabled={row.skipped}
            onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))}
            onBlur={() => dirty && save()}
          />
          <Input
            aria-label={`Last name, row ${row.lineNumber}`}
            className="h-8 w-28"
            value={draft.lastName}
            disabled={row.skipped}
            onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))}
            onBlur={() => dirty && save()}
          />
        </div>
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Admission number, row ${row.lineNumber}`}
          className="h-8 w-36 font-mono"
          value={draft.admissionNumber}
          disabled={row.skipped}
          onChange={(e) => setDraft((d) => ({ ...d, admissionNumber: e.target.value }))}
          onBlur={() => dirty && save()}
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.sectionId || undefined}
          disabled={row.skipped}
          onValueChange={(next) => {
            setDraft((d) => ({ ...d, sectionId: next }));
            startTransition(async () => {
              await saveRow(runId, {
                id: row.id,
                firstName: draft.firstName,
                lastName: draft.lastName,
                admissionNumber: draft.admissionNumber,
                sectionId: next,
                dateOfBirth: row.dateOfBirth ?? "",
                gender: row.gender ?? "",
                rollNumber: row.rollNumber ?? "",
                guardianName: row.guardianName ?? "",
                guardianPhone: row.guardianPhone ?? "",
                skipped: row.skipped,
              });
              router.refresh();
            });
          }}
        >
          <SelectTrigger className="h-8 w-40 cursor-pointer">
            <SelectValue placeholder="No class" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id} className="cursor-pointer">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {pending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : status === "applied" ? (
          <Badge variant="default">
            <CheckCircle2 className="size-3" aria-hidden="true" />
            Imported
          </Badge>
        ) : status === "failed" ? (
          <span className="text-sm font-medium text-destructive">{row.applyError}</span>
        ) : status === "skipped" ? (
          <Badge variant="secondary">Skipped</Badge>
        ) : status === "problem" ? (
          <ul className="flex flex-col gap-0.5">
            {row.problems.map((p) => (
              <li key={p} className="text-xs font-medium text-destructive">
                {p}
              </li>
            ))}
          </ul>
        ) : (
          <Badge variant="outline">Ready</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
          onClick={onToggleSkip}
          className="cursor-pointer"
        >
          {row.skipped ? (
            <Undo2 className="size-4" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
          <span className="sr-only">
            {row.skipped ? "Include" : "Skip"} row {row.lineNumber}
          </span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function PastRuns({ past }: { past: ImportRunRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Previous imports</CardTitle>
        <CardDescription>
          Kept as a permanent record of what was written, and frozen — an imported row cannot be
          edited afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {past.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="rounded-full bg-muted p-3">
              <FileUp className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="max-w-md text-sm text-muted-foreground">
              Nothing has been imported yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.fileName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.appliedAt ?? r.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.rowCount}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {r.appliedCount}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "applied" ? "default" : "secondary"}>
                        {r.status === "applied" ? "Imported" : "Discarded"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
          tone === "warn" ? "text-[color:var(--color-accent)]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
