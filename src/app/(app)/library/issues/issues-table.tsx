"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { format } from "date-fns";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
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
import { listIssues, returnBook, type IssueRow } from "../actions";

function StatusBadge({ row }: { row: IssueRow }) {
  if (row.status === "returned") return <Badge variant="secondary">Returned</Badge>;
  if (row.isOverdue) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant="outline">Issued</Badge>;
}

export function IssuesTable({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [returningId, setReturningId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["library-issues", pageIndex, pageSize, search, status],
    queryFn: () =>
      listIssues({
        pageIndex,
        pageSize,
        search,
        status: status === "all" ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  async function handleReturn(row: IssueRow) {
    setReturningId(row.id);
    const result = await returnBook(row.id);
    setReturningId(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.data.fineAmount > 0) {
      toast.success(`Returned. Fine due: ₹${result.data.fineAmount.toFixed(2)}`);
    } else {
      toast.success("Returned, no fine due");
    }
    queryClient.invalidateQueries({ queryKey: ["library-issues"] });
  }

  const columns: ColumnDef<IssueRow>[] = [
    {
      accessorKey: "bookTitle",
      header: "Book",
      cell: ({ row }) => (
        <Link
          href={`/library/books/${row.original.bookId}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.bookTitle}
        </Link>
      ),
      enableSorting: false,
      meta: { label: "Book" },
    },
    {
      accessorKey: "memberName",
      header: "Member",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span>{row.original.memberName}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.membershipNumber}
          </span>
        </div>
      ),
      enableSorting: false,
      meta: { label: "Member" },
    },
    {
      accessorKey: "issuedAt",
      header: "Issued",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {format(new Date(row.original.issuedAt), "d MMM yyyy")}
        </span>
      ),
      enableSorting: false,
      meta: { label: "Issued" },
    },
    {
      accessorKey: "dueAt",
      header: "Due",
      cell: ({ row }) => (
        <span className="tabular-nums">{format(new Date(row.original.dueAt), "d MMM yyyy")}</span>
      ),
      enableSorting: false,
      meta: { label: "Due" },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge row={row.original} />,
      enableSorting: false,
      meta: { label: "Status" },
    },
    {
      accessorKey: "fineAmount",
      header: "Fine",
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.fineAmount > 0 ? `₹${row.original.fineAmount.toFixed(2)}` : "—"}
        </span>
      ),
      enableSorting: false,
      meta: { label: "Fine" },
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }) =>
              row.original.status === "issued" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={returningId === row.original.id}
                  onClick={() => handleReturn(row.original)}
                >
                  <Undo2 className="size-3.5" aria-hidden="true" />
                  Return
                </Button>
              ) : null,
            enableSorting: false,
            enableHiding: false,
          } satisfies ColumnDef<IssueRow>,
        ]
      : []),
  ];

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
      emptyTitle={status !== "all" || search ? "No issues match those filters" : "Nothing has been issued yet"}
      emptyDescription={
        status !== "all" || search
          ? "Try a different search or status filter."
          : "Issue a book from the catalog to see it here."
      }
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          viewsKey="library-issues"
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          searchPlaceholder="Search book or member…"
          onExport={() =>
            exportRowsToCsv(
              (query.data?.rows ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "bookTitle", label: "Book" },
                { key: "memberName", label: "Member" },
                { key: "membershipNumber", label: "Membership no." },
                { key: "issuedAt", label: "Issued" },
                { key: "dueAt", label: "Due" },
                { key: "status", label: "Status" },
                { key: "fineAmount", label: "Fine" },
              ],
              "schoolos-library-issues.csv",
            )
          }
        >
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[150px]" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
            </SelectContent>
          </Select>
        </DataTableToolbar>
      )}
    />
  );
}
