"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { UserPlus } from "lucide-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { toast } from "sonner";
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
import { listMembers, setMemberStatus, type MemberRow } from "../actions";

const AddMemberDialog = dynamic(() => import("./add-member-dialog"));

function baseColumns(): ColumnDef<MemberRow>[] {
  return [
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
}

export function MembersTable({ canManage }: { canManage: boolean }) {
  const [busy, startBusy] = useTransition();
  const [adding, setAdding] = useState(false);
  const [addMounted, setAddMounted] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const columns = useMemo<ColumnDef<MemberRow>[]>(() => {
    const cols = baseColumns();
    if (!canManage) return cols;
    // Suspending is a librarian's judgement about a borrower; it is undone
    // here too. Expired cards come from a formal leaving and stay expired.
    cols.push({
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const m = row.original;
        if (m.status === "expired") return null;
        const next = m.status === "active" ? "suspended" : "active";
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              startBusy(async () => {
                const result = await setMemberStatus(m.id, next);
                if (!result.ok) toast.error(result.error);
                else {
                  toast.success(next === "active" ? `${m.holderName} can borrow again.` : `${m.holderName} is suspended.`);
                  void query.refetch();
                }
              })
            }
          >
            {next === "active" ? "Reinstate" : "Suspend"}
          </Button>
        );
      },
      enableSorting: false,
      meta: { label: "Actions" },
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, busy]);

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
          : canManage
            ? "Add a member to start lending."
            : "Nobody has a library card yet."
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
          {canManage && (
            <>
              <Button
                size="sm"
                onClick={() => {
                  setAddMounted(true);
                  setAdding(true);
                }}
              >
                <UserPlus className="size-4" aria-hidden="true" />
                Add member
              </Button>
              {addMounted && (
                <AddMemberDialog
                  open={adding}
                  onOpenChange={setAdding}
                  onAdded={() => void query.refetch()}
                />
              )}
            </>
          )}
        </DataTableToolbar>
      )}
    />
  );
}
