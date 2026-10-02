"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table/data-table";
import { loadAllPages } from "@/components/data-table/table-exports";
import { useT } from "@/components/providers/i18n-provider";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { STUDENT_STATUSES } from "@/lib/validations/students-display";
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
  // The reference's "Search Students" panel: a method, its field, and a button
  // that applies it to the same query the table below reads.
  const t = useT();
  const [searchMode, setSearchMode] = useState<"keyword" | "class">("keyword");
  const [keyword, setKeyword] = useState("");
  const [classChoice, setClassChoice] = useState("all");

  const sortColumnMap: Record<string, string> = {
    admissionNumber: "admission_number",
    status: "status",
  };

  const filtered = search !== "" || status !== "all" || sectionId !== "all";

  const readPage = (page: number, size: number) =>
    listStudents({
      pageIndex: page,
      pageSize: size,
      sortBy: sorting[0] ? sortColumnMap[sorting[0].id] : undefined,
      sortDesc: sorting[0]?.desc,
      search,
      status: status === "all" ? undefined : status,
      sectionId: sectionId === "all" ? undefined : sectionId,
    });

  const query = useQuery({
    queryKey: ["students", pageIndex, pageSize, sorting, search, status, sectionId],
    queryFn: () => readPage(pageIndex, pageSize),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-5">
      <form
        className="rounded-md border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (searchMode === "keyword") {
            setSearch(keyword.trim());
            setSectionId("all");
          } else {
            setSearch("");
            setSectionId(classChoice);
          }
          setPageIndex(0);
        }}
      >
        <h2 className="mb-3 font-semibold">{t("students.searchTitle")}</h2>
        <fieldset className="mb-4 flex flex-wrap gap-5 text-sm">
          <legend className="sr-only">{t("students.searchMethod")}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="student-search-mode"
              value="keyword"
              checked={searchMode === "keyword"}
              onChange={() => setSearchMode("keyword")}
            />
            {t("students.byKeyword")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="student-search-mode"
              value="class"
              checked={searchMode === "class"}
              onChange={() => setSearchMode("class")}
            />
            {t("students.byClass")}
          </label>
        </fieldset>
        <div className="flex flex-wrap items-end gap-4">
          {searchMode === "keyword" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="student-keyword">{t("students.keyword")}</Label>
              <Input
                id="student-keyword"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("students.keywordHint")}
                className="w-64"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="student-class">{t("students.classSection")}</Label>
              <select
                id="student-class"
                className="h-9 min-w-56 rounded-md border border-input bg-card px-3 text-sm"
                value={classChoice}
                onChange={(event) => setClassChoice(event.target.value)}
              >
                <option value="all">{t("students.allClasses")}</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button type="submit">{t("students.getStudents")}</Button>
        </div>
      </form>
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
          loadAll={() => loadAllPages(readPage)}
          exportName="students"
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
    </div>
  );
}
