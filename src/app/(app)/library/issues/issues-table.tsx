"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { format } from "date-fns";
import { toast } from "sonner";
import { IndianRupee, Undo2 } from "lucide-react";
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
import { formatMoney } from "@/lib/validations/fees";
import { listIssues, returnBook, waiveStaffFine, type IssueRow } from "../actions";

function StatusBadge({ row }: { row: IssueRow }) {
  if (row.status === "returned") return <Badge variant="secondary">Returned</Badge>;
  if (row.isOverdue) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant="outline">Issued</Badge>;
}

export function IssuesTable({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [returningId, setReturningId] = useState<string | null>(null);
  const [waivingId, setWaivingId] = useState<string | null>(null);

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

    const { fineAmount, billedToFees, studentId } = result.data;

    if (fineAmount === 0) {
      toast.success("Returned, no fine due");
    } else if (billedToFees && studentId) {
      // The fine is now a ledger entry, not a number on this row, so say so
      // and offer the place it can actually be collected.
      toast.success(`Returned. ${formatMoney(fineAmount)} billed to the fee account`, {
        action: {
          label: "Open account",
          onClick: () => router.push(`/fees/students/${studentId}`),
        },
      });
    } else {
      // Staff have no fee account; the fine is collected on the next payroll run
      // (migration 0065) or waived here.
      toast.success(
        `Returned. ${formatMoney(fineAmount)} staff fine — it will be collected on the next payroll run, or can be waived here.`,
      );
    }
    queryClient.invalidateQueries({ queryKey: ["library-issues"] });
  }

  async function handleWaive(row: IssueRow) {
    if (!window.confirm(`Waive the ${formatMoney(row.fineAmount)} fine for ${row.memberName}? This records a write-off; it does not erase that the book was late.`)) {
      return;
    }
    setWaivingId(row.id);
    const result = await waiveStaffFine(row.id);
    setWaivingId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Fine waived.");
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
      cell: ({ row }) => {
        const issue = row.original;

        // Still out and late: nothing is booked yet, and the amount is a
        // running estimate. Labelled "accruing" so nobody reads it as a debt
        // already on the family's account.
        if (issue.status === "issued") {
          if (issue.accruedFine <= 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-col gap-0.5">
              <span className="font-mono tabular-nums">{formatMoney(issue.accruedFine)}</span>
              <span className="text-xs text-muted-foreground">
                Accruing · {issue.daysLate} {issue.daysLate === 1 ? "day" : "days"}
              </span>
            </div>
          );
        }

        if (issue.fineAmount <= 0) {
          return <span className="text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-col items-start gap-1">
            <span className="font-mono tabular-nums">{formatMoney(issue.fineAmount)}</span>
            {issue.isStaff ? (
              issue.staffFineWaived ? (
                <span className="text-xs text-muted-foreground">Waived</span>
              ) : issue.staffFineSettled ? (
                <span className="text-xs text-muted-foreground">Collected on payslip</span>
              ) : (
                <span className="text-xs text-muted-foreground">Owed — collected via payroll</span>
              )
            ) : issue.billedToFees && issue.studentId ? (
              <Link
                href={`/fees/students/${issue.studentId}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                <IndianRupee className="size-3" aria-hidden="true" />
                On fee account
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">Not billed to fees</span>
            )}
          </div>
        );
      },
      enableSorting: false,
      meta: { label: "Fine" },
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }) => {
              const issue = row.original;
              const canWaive =
                issue.isStaff &&
                issue.fineAmount > 0 &&
                !issue.staffFineSettled &&
                !issue.staffFineWaived;
              return (
                <div className="flex justify-end gap-1">
                  {issue.status === "issued" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={returningId === issue.id}
                      onClick={() => handleReturn(issue)}
                    >
                      <Undo2 className="size-3.5" aria-hidden="true" />
                      Return
                    </Button>
                  )}
                  {canWaive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={waivingId === issue.id}
                      onClick={() => handleWaive(issue)}
                    >
                      Waive
                    </Button>
                  )}
                </div>
              );
            },
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
                { key: "accruedFine", label: "Accruing fine" },
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
