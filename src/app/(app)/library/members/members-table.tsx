"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, exportRowsToCsv } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { listMembers, type MemberRow } from "../actions";

const columns: ColumnDef<MemberRow>[] = [
  {
    accessorKey: "membershipNumber",
    header: "Membership no.",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.membershipNumber}</span>,
    enableSorting: false,
    meta: { label: "Membership no." },
  },
  {
    accessorKey: "holderName",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.holderName}</span>,
    enableSorting: false,
    meta: { label: "Name" },
  },
  {
    accessorKey: "holderType",
    header: "Type",
    cell: ({ row }) => <Badge variant="secondary">{row.original.holderType}</Badge>,
    enableSorting: false,
    meta: { label: "Type" },
  },
  {
    accessorKey: "holderRef",
    header: "Reference",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.holderRef}</span>,
    enableSorting: false,
    meta: { label: "Reference" },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <Badge variant={status === "active" ? "success" : status === "suspended" ? "warning" : "outline"}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      );
    },
    enableSorting: false,
    meta: { label: "Status" },
  },
  {
    id: "booksOut",
    header: "Books out",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.booksOut}/{row.original.maxBooks}
      </span>
    ),
    enableSorting: false,
    meta: { label: "Books out" },
  },
];

export function MembersTable() {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const query = useQuery({
    queryKey: ["library-members", pageIndex, pageSize, search, status],
    queryFn: () =>
      listMembers({
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
      emptyTitle={search || status !== "all" ? "No members match those filters" : "No library members yet"}
      emptyDescription={
        search || status !== "all"
          ? "Try a different search or clear the status filter."
          : "Enrol a student or staff member to start lending."
      }
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          viewsKey="library-members"
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          searchPlaceholder="Search membership number…"
          onExport={() =>
            exportRowsToCsv(
              (query.data?.rows ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "membershipNumber", label: "Membership no." },
                { key: "holderName", label: "Name" },
                { key: "holderType", label: "Type" },
                { key: "holderRef", label: "Reference" },
                { key: "status", label: "Status" },
                { key: "booksOut", label: "Books out" },
                { key: "maxBooks", label: "Limit" },
              ],
              "schoolos-library-members.csv",
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
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </DataTableToolbar>
      )}
    />
  );
}
