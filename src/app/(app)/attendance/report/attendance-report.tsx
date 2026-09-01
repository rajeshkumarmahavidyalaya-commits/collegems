"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, exportRowsToCsv } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import {
  getAttendanceSummary,
  getMarkedDates,
  type AttendanceSummaryRow,
  type SectionOption,
} from "../actions";

/**
 * The thresholds a school actually acts on: below 75% is usually the line for
 * exam eligibility in Indian schools, and 85% is the "watch this" band. The
 * band is stated in words as well as colour.
 */
function band(percentage: number | null): { label: string; variant: "success" | "warning" | "destructive" | "outline" } {
  if (percentage === null) return { label: "Not marked", variant: "outline" };
  if (percentage < 75) return { label: "Below 75%", variant: "destructive" };
  if (percentage < 85) return { label: "At risk", variant: "warning" };
  return { label: "On track", variant: "success" };
}

function isoDaysAgo(days: number) {
  const now = new Date();
  now.setDate(now.getDate() - days);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const columns: ColumnDef<AttendanceSummaryRow>[] = [
  {
    accessorKey: "rollNumber",
    header: "Roll",
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">{row.original.rollNumber ?? "—"}</span>
    ),
    enableSorting: false,
    meta: { label: "Roll" },
  },
  {
    accessorKey: "fullName",
    header: "Student",
    cell: ({ row }) => (
      <Link
        href={`/students/${row.original.studentId}`}
        className="font-medium underline-offset-4 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.original.fullName}
      </Link>
    ),
    enableSorting: false,
    meta: { label: "Student" },
  },
  {
    accessorKey: "present",
    header: "Present",
    cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.present}</span>,
    enableSorting: false,
    meta: { label: "Present" },
  },
  {
    accessorKey: "absent",
    header: "Absent",
    cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.absent}</span>,
    enableSorting: false,
    meta: { label: "Absent" },
  },
  {
    accessorKey: "late",
    header: "Late",
    cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.late}</span>,
    enableSorting: false,
    meta: { label: "Late" },
  },
  {
    accessorKey: "excused",
    header: "Excused",
    cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.excused}</span>,
    enableSorting: false,
    meta: { label: "Excused" },
  },
  {
    accessorKey: "percentage",
    header: "Attendance",
    cell: ({ row }) => {
      const { percentage } = row.original;
      const b = band(percentage);
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums">
            {percentage === null ? "—" : `${percentage}%`}
          </span>
          <Badge variant={b.variant}>{b.label}</Badge>
        </div>
      );
    },
    enableSorting: false,
    meta: { label: "Attendance" },
  },
];

export function AttendanceReport({ sections }: { sections: SectionOption[] }) {
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? "");
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayIso());
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const query = useQuery({
    queryKey: ["attendance-summary", sectionId, from, to],
    queryFn: () => getAttendanceSummary({ sectionId, from, to }),
    enabled: sectionId !== "" && from <= to,
    placeholderData: keepPreviousData,
  });

  const datesQuery = useQuery({
    queryKey: ["attendance-marked-dates", sectionId, from, to],
    queryFn: () => getMarkedDates({ sectionId, from, to }),
    enabled: sectionId !== "" && from <= to,
    placeholderData: keepPreviousData,
  });

  // Filtering and paging happen here rather than in the action: the result is
  // one class's roster, which is small, and slicing it locally keeps the
  // search instant instead of round-tripping per keystroke.
  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(needle) ||
        r.admissionNumber.toLowerCase().includes(needle) ||
        (r.rollNumber ?? "").toLowerCase().includes(needle),
    );
  }, [query.data, search]);

  const page = filtered.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize);
  const markedDays = datesQuery.data?.length ?? 0;
  const invalidRange = from > to;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor="report-section">Class</Label>
          <Select
            value={sectionId}
            onValueChange={(v) => {
              setSectionId(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger id="report-section" className="w-full sm:w-[200px]">
              <SelectValue placeholder="Choose a class" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-[150px] flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor="report-from">From</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPageIndex(0);
            }}
            aria-describedby={invalidRange ? "report-range-error" : undefined}
            aria-invalid={invalidRange}
            className="w-full sm:w-[170px]"
          />
        </div>

        <div className="flex min-w-[150px] flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor="report-to">To</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            max={todayIso()}
            onChange={(e) => {
              setTo(e.target.value);
              setPageIndex(0);
            }}
            aria-describedby={invalidRange ? "report-range-error" : undefined}
            aria-invalid={invalidRange}
            className="w-full sm:w-[170px]"
          />
        </div>

        <p className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden="true" />
          <span aria-live="polite">
            {markedDays} {markedDays === 1 ? "day" : "days"} marked in this range
          </span>
        </p>
      </div>

      {invalidRange && (
        <p id="report-range-error" role="alert" className="text-sm text-destructive">
          The “from” date is after the “to” date. Swap them to see results.
        </p>
      )}

      <DataTable
        columns={columns}
        data={page}
        totalCount={filtered.length}
        getRowId={(row) => row.enrolmentId}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={setPageIndex}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPageIndex(0);
        }}
        sorting={sorting}
        onSortingChange={setSorting}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={search ? "No students match that search" : "Nothing marked in this range"}
        emptyDescription={
          search
            ? "Try a different name, roll number or admission number."
            : "Pick a wider date range, or take the register for this class first."
        }
        toolbar={(table) => (
          <DataTableToolbar
            table={table}
            viewsKey="attendance-report"
            searchValue={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPageIndex(0);
            }}
            searchPlaceholder="Search name or roll…"
            onExport={() =>
              exportRowsToCsv(
                filtered as unknown as Record<string, unknown>[],
                [
                  { key: "rollNumber", label: "Roll" },
                  { key: "admissionNumber", label: "Admission no." },
                  { key: "fullName", label: "Student" },
                  { key: "present", label: "Present" },
                  { key: "absent", label: "Absent" },
                  { key: "late", label: "Late" },
                  { key: "excused", label: "Excused" },
                  { key: "percentage", label: "Attendance %" },
                ],
                `schoolos-attendance-${from}-to-${to}.csv`,
              )
            }
          />
        )}
      />
    </div>
  );
}
