"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, exportRowsToCsv } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { STAFF_STATUSES, staffStatusLabel, staffStatusTone } from "@/lib/validations/staff-display";
import { listStaff, type StaffRow } from "./actions";
import { useT } from "@/components/providers/i18n-provider";
import type { Translator } from "@/lib/i18n/translate";

/**
 * A factory, not a constant. A module-scope `ColumnDef[]` has no component for
 * a hook to belong to — rule 15's third shape, the same reason
 * `invoiceColumns(formatDate)` exists — so the translator arrives as an
 * argument and the call sits inside `useMemo`.
 */
function staffColumns(t: Translator): ColumnDef<StaffRow>[] {
  return [
    {
      accessorKey: "employeeCode",
      header: "Code",
      cell: ({ row }) => (
        <Link
          href={`/staff/${row.original.id}`}
          className="font-mono text-xs underline-offset-4 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.employeeCode}
        </Link>
      ),
      enableSorting: false,
      meta: { label: "Code" },
    },
    {
      accessorKey: "fullName",
      header: "Name",
      cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      enableSorting: false,
      meta: { label: "Name" },
    },
    {
      accessorKey: "designation",
      header: "Designation",
      enableSorting: false,
      meta: { label: "Designation" },
    },
    {
      accessorKey: "department",
      header: "Department",
      cell: ({ row }) => row.original.department ?? <span className="text-muted-foreground">—</span>,
      enableSorting: false,
      meta: { label: "Department" },
    },
    {
      accessorKey: "lessons",
      header: "Lessons",
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums">
          {row.original.lessons}
          {row.original.classTeacherOf > 0 && (
            <span className="ms-2 text-muted-foreground">
              · CT&nbsp;{row.original.classTeacherOf}
            </span>
          )}
        </span>
      ),
      enableSorting: false,
      meta: { label: "Lessons" },
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone ?? "—"}</span>,
      enableSorting: false,
      meta: { label: "Phone" },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <Badge variant={staffStatusTone(row.original.status)} className="w-fit">
            {staffStatusLabel(row.original.status, t)}
          </Badge>
          {row.original.dateOfLeaving && (
            <span className="text-xs text-muted-foreground">
              left {row.original.dateOfLeaving}
            </span>
          )}
        </div>
      ),
      enableSorting: false,
      meta: { label: "Status" },
    },
  ];
}

export function StaffTable({ canManage }: { canManage: boolean }) {
  const t = useT();
  const columns = useMemo(() => staffColumns(t), [t]);
  const router = useRouter();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const filtered = search !== "" || status !== "all";

  const query = useQuery({
    queryKey: ["staff", pageIndex, pageSize, search, status],
    queryFn: () =>
      listStaff({
        pageIndex,
        pageSize,
        search,
        status: status === "all" ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <DataTable
      columns={columns}
      data={query.data?.rows ?? []}
      totalCount={query.data?.total ?? 0}
      getRowId={(row) => row.id}
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
      emptyTitle={filtered ? "Nobody matches those filters" : "No staff on the roster yet"}
      emptyDescription={
        filtered
          ? "Try a different name, code or designation, or show every status."
          : "Add the first member of staff — the timetable, the register and payroll all read this list."
      }
      emptyAction={
        canManage ? (
          <Button asChild size="sm">
            <Link href="/staff/new">
              <UserPlus className="size-4" aria-hidden="true" />
              Add staff
            </Link>
          </Button>
        ) : undefined
      }
      onRowClick={(row) => router.push(`/staff/${row.id}`)}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          viewsKey="staff"
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          searchPlaceholder="Search name, code or designation…"
          onExport={() =>
            exportRowsToCsv(
              (query.data?.rows ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "employeeCode", label: "Code" },
                { key: "fullName", label: "Name" },
                { key: "designation", label: "Designation" },
                { key: "department", label: "Department" },
                { key: "dateOfJoining", label: "Joined" },
                { key: "dateOfLeaving", label: "Left" },
                { key: "phone", label: "Phone" },
                { key: "email", label: "Email" },
                { key: "status", label: "Status" },
              ],
              "schoolos-staff.csv",
            )
          }
        >
          {/*
            Defaulting to Active rather than All, because a roster is a list of
            who is here. Leavers are one selection away and never deleted —
            payroll, the audit log and last year's timetable all still name
            them.
          */}
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[150px]" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STAFF_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DataTableToolbar>
      )}
    />
  );
}
