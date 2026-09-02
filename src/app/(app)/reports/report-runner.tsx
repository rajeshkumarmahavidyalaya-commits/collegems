"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Printer,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportRowsToCsv } from "@/components/data-table/data-table";
import {
  alignFor,
  defaultDateRange,
  exportFilename,
  formatCell,
  missingRequired,
  type ParamDescriptor,
} from "@/lib/validations/reports";
import {
  runReport,
  type ParamOptions,
  type ReportDefinition,
  type ReportResult,
} from "./actions";

type Props = {
  reports: ReportDefinition[];
  options: ParamOptions;
};

/**
 * One screen for every report. The catalog says what parameters a report takes
 * and what columns it returns, so this component renders any report the
 * database grows without being edited — which is the whole reason the kernel
 * stores that description as data rather than as forty React components.
 */
export function ReportRunner({ reports, options }: Props) {
  const [selectedKey, setSelectedKey] = useState(reports[0]?.key ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");

  const report = reports.find((r) => r.key === selectedKey);

  // Switching report clears the previous answer rather than leaving it under a
  // new title. A table of fee defaulters sitting beneath the heading
  // "Attendance summary" is worse than an empty state.
  useEffect(() => {
    setResult(null);
    setTouched(false);
    setSearch("");

    const next: Record<string, string> = {};
    const range = defaultDateRange();
    for (const p of report?.parameters ?? []) {
      // A date range that defaults to the last thirty days means most reports
      // answer something useful on the first press, instead of demanding two
      // dates before they will say anything at all.
      if (p.type === "date") next[p.name] = p.name === "from" ? range.from : range.to;
      else next[p.name] = "";
    }
    setParams(next);
  }, [selectedKey, report]);

  const missing = report ? missingRequired(report.parameters, params) : [];

  const grouped = useMemo(() => {
    const map = new Map<string, ReportDefinition[]>();
    for (const r of reports) {
      const list = map.get(r.module) ?? [];
      list.push(r);
      map.set(r.module, list);
    }
    return [...map.entries()];
  }, [reports]);

  const visibleRows = useMemo(() => {
    if (!result) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return result.rows;
    return result.rows.filter((row) =>
      Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(needle)),
    );
  }, [result, search]);

  function run() {
    if (!report) return;
    setTouched(true);
    if (missing.length > 0) {
      toast.error("Fill in the highlighted filters first.");
      return;
    }

    startTransition(async () => {
      const response = await runReport({ key: report.key, params, limit: 1000 });
      if (!response.ok) {
        setResult(null);
        toast.error(response.error);
        return;
      }
      setResult(response.data);
    });
  }

  function exportCsv() {
    if (!report || !result) return;
    exportRowsToCsv(
      // The exported value is the formatted one, so a spreadsheet shows
      // "₹8,640.00" and "12 Sep 2025" rather than raw numbers and ISO stamps.
      visibleRows.map((row) =>
        Object.fromEntries(
          report.columns.map((c) => [c.key, formatCell(row[c.key], c.type)]),
        ),
      ),
      report.columns.map((c) => ({ key: c.key, label: c.label })),
      exportFilename(report.key),
    );
  }

  if (reports.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <FileSpreadsheet className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <div>
            <p className="font-medium">No reports available to your role</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Each report needs a matching permission. An administrator can grant one under the
              role permissions for your account.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4" data-print="hide">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report</CardTitle>
            <CardDescription>{report?.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-key">Choose a report</Label>
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger id="report-key">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {grouped.map(([module, list]) => (
                    <SelectGroupBlock key={module} module={module} list={list} />
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(report?.parameters ?? []).map((p) => (
              <ParamControl
                key={p.name}
                descriptor={p}
                value={params[p.name] ?? ""}
                onChange={(v) => setParams((prev) => ({ ...prev, [p.name]: v }))}
                options={options}
                invalid={touched && missing.includes(p.name)}
              />
            ))}

            <Button onClick={run} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              Run report
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3" data-print="hide">
          <h2 className="text-lg font-medium">{report?.name}</h2>

          {result && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-mono tabular-nums text-foreground">
                {visibleRows.length.toLocaleString("en-IN")}
              </span>{" "}
              {search ? `of ${result.rows.length} shown` : "rows"}
              {result.truncated && ` · ${result.totalCount.toLocaleString("en-IN")} in total`}
            </p>
          )}

          {result && result.rows.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter these rows"
                  className="w-48 pl-8"
                  aria-label="Filter the rows already returned"
                />
              </div>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="size-4" aria-hidden="true" />
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden="true" />
                Print
              </Button>
            </div>
          )}
        </div>

        {result?.truncated && (
          <Alert data-print="hide">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>Showing the first {result.rows.length.toLocaleString("en-IN")} rows</AlertTitle>
            <AlertDescription>
              This report matched {result.totalCount.toLocaleString("en-IN")} rows. Narrow the
              filters to get a complete answer — an export of everything is queued work that is
              not built yet, so this deliberately shows a prefix rather than pretending it is the
              whole set.
            </AlertDescription>
          </Alert>
        )}

        {pending ? (
          <ResultSkeleton columns={report?.columns.length ?? 6} />
        ) : !result ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <Play className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">Nothing run yet</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Set the filters and press <span className="font-medium">Run report</span>. The
                  answer appears here, and can be exported or printed.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : visibleRows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="rounded-full bg-muted p-3">
                <FileSpreadsheet className="size-6 text-muted-foreground" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium">
                  {search ? "No rows match that filter" : "Nothing matched"}
                </p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {search
                    ? "Clear the filter to see everything this report returned."
                    : "The report ran without error — there is simply nothing in the data that fits those filters."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <caption className="sr-only">{report?.name}</caption>
              <TableHeader>
                <TableRow>
                  {report?.columns.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn("whitespace-nowrap", alignFor(c) === "right" && "text-right")}
                    >
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row, i) => (
                  <TableRow key={i}>
                    {report?.columns.map((c) => {
                      const rendered = formatCell(row[c.key], c.type);
                      return (
                        <TableCell
                          key={c.key}
                          className={cn(
                            alignFor(c) === "right" && "text-right font-mono tabular-nums",
                            c.type === "text" && "max-w-64 truncate",
                          )}
                        >
                          {c.type === "badge" && rendered !== "—" ? (
                            <Badge variant="outline" className="font-normal">
                              {rendered}
                            </Badge>
                          ) : (
                            rendered
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Radix's Select does not take a fragment of items, so the module heading and
 * its reports are rendered together here rather than inlined.
 */
function SelectGroupBlock({ module, list }: { module: string; list: ReportDefinition[] }) {
  return (
    <>
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{module}</div>
      {list.map((r) => (
        <SelectItem key={r.key} value={r.key}>
          {r.name}
        </SelectItem>
      ))}
    </>
  );
}

function ParamControl({
  descriptor,
  value,
  onChange,
  options,
  invalid,
}: {
  descriptor: ParamDescriptor;
  value: string;
  onChange: (value: string) => void;
  options: ParamOptions;
  invalid: boolean;
}) {
  const id = `param-${descriptor.name}`;

  const label = (
    <Label htmlFor={id} className={cn(invalid && "text-destructive")}>
      {descriptor.label}
      {descriptor.required && (
        <span aria-hidden="true" className="text-destructive">
          {" "}
          *
        </span>
      )}
    </Label>
  );

  // "All" is an explicit option rather than a blank: a filter left empty is
  // indistinguishable from one nobody noticed, and the two mean different
  // things to whoever reads the printout later.
  const choices =
    descriptor.type === "section"
      ? [{ value: "", label: "Every class" }, ...options.sections.map((s) => ({ value: s.id, label: s.label }))]
      : descriptor.type === "class_level"
        ? [{ value: "", label: "Every year group" }, ...options.classLevels.map((l) => ({ value: l.id, label: l.label }))]
        : descriptor.type === "select"
          ? [{ value: "", label: "Any" }, ...descriptor.options]
          : null;

  if (choices) {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        {/* Radix reserves "" for "no selection", so the all-values option
            travels as a sentinel and is mapped back on the way out. */}
        <Select value={value === "" ? "__all__" : value} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
          <SelectTrigger id={id} aria-invalid={invalid || undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c.value || "__all__"} value={c.value === "" ? "__all__" : c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {invalid && <p className="text-sm text-destructive">Choose one to run this report.</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <Input
        id={id}
        type={descriptor.type === "date" ? "date" : descriptor.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
      />
      {invalid && <p className="text-sm text-destructive">This one is required.</p>}
    </div>
  );
}

function ResultSkeleton({ columns }: { columns: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex gap-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      {Array.from({ length: 8 }).map((_, r) => (
        <div key={r} className="mt-2 flex gap-2">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
