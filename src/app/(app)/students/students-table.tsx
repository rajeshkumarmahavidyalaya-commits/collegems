"use client";

import { useState } from "react";
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
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { STUDENT_STATUSES } from "@/lib/validations/students";
import { listStudents, type StudentRow } from "./actions";

/** Status is never colour-only -- the badge always carries its label. */
function statusVariant(status: string): "default" | "secondary" | "success" | "warning" {
  if (status === "active") return "success";
  if (status === "alumni") return "secondary";
  if (status === "inactive") return "warning";
  return "default";
}

const columns: ColumnDef<StudentRow>[] = [
  {
    accessorKey: "admissionNumber",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Admission no." />,
    cell: ({ row }) => (
      <Link
        href={`/students/${row.original.id}`}
        className="font-mono text-xs underline-offset-4 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.original.admissionNumber}
      </Link>
    ),
    meta: { label: "Admission no." },
  },
  {
    accessorKey: "fullName",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
    enableSorting: false,
    meta: { label: "Name" },
  },
  {
    accessorKey: "sectionLabel",
    header: "Class · section",
    cell: ({ row }) =>
      row.original.sectionLabel ? (
        <span>{row.original.sectionLabel}</span>
      ) : (
        <span className="text-muted-foreground">Not enrolled</span>
      ),
    enableSorting: false,
    meta: { label: "Class · section" },
  },
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
    accessorKey: "guardianName",
    header: "Primary guardian",
    cell: ({ row }) => row.original.guardianName ?? <span className="text-muted-foreground">—</span>,
    enableSorting: false,
    meta: { label: "Primary guardian" },
  },
  {
    accessorKey: "phone",
    header: "Phone",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.phone ?? "—"}</span>
    ),
    enableSorting: false,
    meta: { label: "Phone" },
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => (
      <Badge variant={statusVariant(row.original.status)} className="capitalize">
        {row.original.status}
      </Badge>
    ),
    meta: { label: "Status" },
  },
];

export function StudentsTable({
  sections,
  canManage,
}: {
  sections: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([{ id: "admissionNumber", desc: false }]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sectionId, setSectionId] = useState("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const sortColumnMap: Record<string, string> = {
    admissionNumber: "admission_number",
    status: "status",
  };

  const filtered = search !== "" || status !== "all" || sectionId !== "all";

  const query = useQuery({
    queryKey: ["students", pageIndex, pageSize, sorting, search, status, sectionId],
    queryFn: () =>
      listStudents({
        pageIndex,
        pageSize,
        sortBy: sorting[0] ? sortColumnMap[sorting[0].id] : undefined,
        sortDesc: sorting[0]?.desc,
        search,
        status: status === "all" ? undefined : status,
        sectionId: sectionId === "all" ? undefined : sectionId,
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
      onSortingChange={(next) => {
        setSorting(next);
        setPageIndex(0);
      }}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={setColumnVisibility}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => query.refetch()}
      emptyTitle={filtered ? "No students match those filters" : "No students admitted yet"}
      emptyDescription={
        filtered
          ? "Try a different admission number, or clear the class and status filters."
          : "Admit the first student to start building the register."
      }
      emptyAction={
        canManage ? (
          <Button asChild size="sm">
            <Link href="/students/new">
              <UserPlus className="size-4" aria-hidden="true" />
              Admit a student
            </Link>
          </Button>
        ) : undefined
      }
      onRowClick={(row) => router.push(`/students/${row.id}`)}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          viewsKey="students"
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          searchPlaceholder="Search admission number…"
          onExport={() =>
            exportRowsToCsv(
              (query.data?.rows ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "admissionNumber", label: "Admission no." },
                { key: "fullName", label: "Name" },
                { key: "sectionLabel", label: "Class · section" },
                { key: "rollNumber", label: "Roll" },
                { key: "guardianName", label: "Primary guardian" },
                { key: "phone", label: "Phone" },
                { key: "status", label: "Status" },
              ],
              "schoolos-students.csv",
            )
          }
        >
          <Select
            value={sectionId}
            onValueChange={(v) => {
              setSectionId(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[180px]" aria-label="Filter by class">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[140px]" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STUDENT_STATUSES.map((s) => (
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
