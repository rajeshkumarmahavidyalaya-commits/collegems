"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Printer, UserPlus } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
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
import { DataTable } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { loadAllPages } from "@/components/data-table/table-exports";
import { listMembers, setMemberStatus, type MemberRow } from "../actions";

const AddMemberDialog = dynamic(() => import("./add-member-dialog"));

/**
 * The reference's columns: Card Number, Issued to, Enrollment Number, Class,
 * Section, Date Issued, Print, Action. Status and books out stay beside them,
 * because a suspended card and a full one are what a librarian looks for.
 */
function baseColumns(formatDate: (d: string) => string): ColumnDef<MemberRow>[] {
  const dash = <span className="text-muted-foreground">—</span>;
  return [
    {
      accessorKey: "membershipNumber",
      header: "Card Number",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.membershipNumber}</span>,
      enableSorting: false,
      meta: { label: "Card Number" },
    },
    {
      accessorKey: "holderName",
      header: "Issued to",
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.holderName}</span>
          <Badge variant="secondary" className="ms-2">
            {row.original.holderType}
          </Badge>
        </div>
      ),
      enableSorting: false,
      meta: { label: "Issued to" },
    },
    {
      accessorKey: "holderRef",
      header: "Enrollment Number",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.holderRef}</span>,
      enableSorting: false,
      meta: { label: "Enrollment Number" },
    },
    {
      accessorKey: "className",
      header: "Class",
      cell: ({ row }) => row.original.className ?? dash,
      enableSorting: false,
      meta: { label: "Class" },
    },
    {
      accessorKey: "sectionName",
      header: "Section",
      cell: ({ row }) => row.original.sectionName ?? dash,
      enableSorting: false,
      meta: { label: "Section" },
    },
    {
      accessorKey: "joinedAt",
      header: "Date Issued",
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.joinedAt)}</span>,
      enableSorting: false,
      meta: { label: "Date Issued" },
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
    {
      id: "print",
      header: "Print",
      cell: ({ row }) => (
        <Button asChild size="sm" variant="ghost" aria-label={`Print the card of ${row.original.holderName}`}>
          <Link href={`/library/members/${row.original.id}/card`}>
            <Printer className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

export function MembersTable({ canManage }: { canManage: boolean }) {
  const { formatDate } = useI18n();
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
    const cols = baseColumns((d) => formatDate(d));
    if (!canManage) return cols;
    // Suspending is a librarian's judgement about a borrower; it is undone
    // here too. Expired cards come from a formal leaving and stay expired.
    cols.push({
      id: "actions",
      header: "Action",
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
  }, [canManage, busy, formatDate]);

  const readPage = (page: number, size: number) =>
    listMembers({
      pageIndex: page,
      pageSize: size,
      search,
      status: status === "all" ? undefined : status,
    });

  const query = useQuery({
    queryKey: ["library-members", pageIndex, pageSize, search, status],
    queryFn: () => readPage(pageIndex, pageSize),
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
            ? "Issue a library card to start lending."
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
          searchPlaceholder="Search card number…"
          loadAll={() => loadAllPages(readPage)}
          exportName="library-cards"
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
                Issue Library Card
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
