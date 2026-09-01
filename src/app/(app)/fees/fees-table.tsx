"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { IndianRupee, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { formatMoney } from "@/lib/validations/fees";
import { listBalances, type BalanceRow } from "./actions";
import { RecordPaymentDialog, type StudentTarget } from "./fee-dialogs";

/**
 * Balance state, in words as well as colour. "In credit" matters as its own
 * state rather than being folded into "settled": the school is holding that
 * family's money and may owe a refund.
 */
function balanceState(balance: number): { label: string; variant: "success" | "destructive" | "secondary" } {
  if (balance > 0) return { label: "Outstanding", variant: "destructive" };
  if (balance < 0) return { label: "In credit", variant: "secondary" };
  return { label: "Settled", variant: "success" };
}

function money(value: number) {
  return <span className="font-mono tabular-nums">{formatMoney(value)}</span>;
}

export function FeesTable({
  sections,
  canCollect,
}: {
  sections: { id: string; label: string }[];
  canCollect: boolean;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([{ id: "balance", desc: true }]);
  const [sectionId, setSectionId] = useState("all");
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [search, setSearch] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    // Present but off by default: most schools use neither often, and the
    // table has to stay readable on a laptop at the front desk.
    writeOffs: false,
    refunds: false,
  });
  const [collecting, setCollecting] = useState<StudentTarget | null>(null);

  const sortColumnMap: Record<string, string> = {
    fullName: "full_name",
    admissionNumber: "admission_number",
    balance: "balance",
    charged: "charged",
    paid: "paid",
    lastPaymentAt: "last_payment_at",
  };

  const query = useQuery({
    queryKey: ["fee-balances", pageIndex, pageSize, sorting, sectionId, onlyOutstanding],
    queryFn: () =>
      listBalances({
        pageIndex,
        pageSize,
        sortBy: sorting[0] ? sortColumnMap[sorting[0].id] : undefined,
        sortDesc: sorting[0]?.desc,
        sectionId: sectionId === "all" ? undefined : sectionId,
        onlyOutstanding,
      }),
    placeholderData: keepPreviousData,
  });

  // Searching filters the page in hand rather than the whole set: the balance
  // function has no text predicate, and adding one would mean sorting and
  // paging in two places. Class + outstanding are the filters that matter here;
  // finding one child by name is what the ⌘K palette is for.
  const needle = search.trim().toLowerCase();
  const rows = (query.data?.rows ?? []).filter(
    (r) =>
      !needle ||
      r.fullName.toLowerCase().includes(needle) ||
      r.admissionNumber.toLowerCase().includes(needle) ||
      (r.rollNumber ?? "").toLowerCase().includes(needle),
  );

  const columns: ColumnDef<BalanceRow>[] = [
    {
      accessorKey: "admissionNumber",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Admission no." />,
      cell: ({ row }) => (
        <Link
          href={`/fees/students/${row.original.studentId}`}
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
      header: ({ column }) => <DataTableColumnHeader column={column} title="Student" />,
      cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
      meta: { label: "Student" },
    },
    {
      accessorKey: "sectionLabel",
      header: "Class",
      cell: ({ row }) => row.original.sectionLabel ?? "—",
      enableSorting: false,
      meta: { label: "Class" },
    },
    {
      accessorKey: "charged",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Billed" />,
      cell: ({ row }) => money(row.original.charged + row.original.fines),
      meta: { label: "Billed" },
    },
    {
      accessorKey: "discounts",
      header: "Discounts",
      cell: ({ row }) => money(row.original.discounts),
      enableSorting: false,
      meta: { label: "Discounts" },
    },
    {
      accessorKey: "writeOffs",
      header: "Written off",
      cell: ({ row }) => money(row.original.writeOffs),
      enableSorting: false,
      meta: { label: "Written off" },
    },
    {
      accessorKey: "paid",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Paid" />,
      cell: ({ row }) => money(row.original.paid),
      meta: { label: "Paid" },
    },
    {
      accessorKey: "refunds",
      header: "Refunded",
      cell: ({ row }) => money(row.original.refunds),
      enableSorting: false,
      meta: { label: "Refunded" },
    },
    {
      accessorKey: "balance",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Balance" />,
      cell: ({ row }) => {
        const state = balanceState(row.original.balance);
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono font-medium tabular-nums">
              {formatMoney(Math.abs(row.original.balance))}
            </span>
            <Badge variant={state.variant}>{state.label}</Badge>
          </div>
        );
      },
      meta: { label: "Balance" },
    },
    {
      id: "collect",
      header: "",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) =>
        canCollect ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setCollecting({
                id: row.original.studentId,
                fullName: row.original.fullName,
                admissionNumber: row.original.admissionNumber,
                balance: row.original.balance,
              });
            }}
          >
            <IndianRupee className="size-4" aria-hidden="true" />
            Collect
          </Button>
        ) : null,
      meta: { label: "Collect" },
    },
  ];

  const filtered = sectionId !== "all" || onlyOutstanding || needle !== "";

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        totalCount={query.data?.total ?? 0}
        getRowId={(row) => row.studentId}
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
        emptyTitle={filtered ? "No students match those filters" : "Nothing billed yet"}
        emptyDescription={
          filtered
            ? "Try a different class, or turn off the outstanding-only filter."
            : "Set up fee heads and amounts, then raise invoices for a class."
        }
        emptyAction={
          !filtered ? (
            <Button asChild size="sm">
              <Link href="/fees/setup">
                <Receipt className="size-4" aria-hidden="true" />
                Set up fees
              </Link>
            </Button>
          ) : undefined
        }
        toolbar={(table) => (
          <DataTableToolbar
            table={table}
            viewsKey="fees"
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search this page…"
            onExport={() =>
              exportRowsToCsv(
                rows as unknown as Record<string, unknown>[],
                [
                  { key: "admissionNumber", label: "Admission no." },
                  { key: "fullName", label: "Student" },
                  { key: "sectionLabel", label: "Class" },
                  { key: "charged", label: "Charged" },
                  { key: "fines", label: "Fines" },
                  { key: "discounts", label: "Discounts" },
                  { key: "writeOffs", label: "Written off" },
                  { key: "paid", label: "Paid" },
                  { key: "refunds", label: "Refunded" },
                  { key: "balance", label: "Balance" },
                ],
                "schoolos-fee-balances.csv",
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

            <div className="flex items-center gap-2">
              <Switch
                id="only-outstanding"
                checked={onlyOutstanding}
                onCheckedChange={(v) => {
                  setOnlyOutstanding(v);
                  setPageIndex(0);
                }}
              />
              <Label htmlFor="only-outstanding" className="text-sm font-normal">
                Only those who owe
              </Label>
            </div>
          </DataTableToolbar>
        )}
      />

      {collecting && (
        <RecordPaymentDialog
          student={collecting}
          open={collecting !== null}
          onOpenChange={(open) => !open && setCollecting(null)}
          onDone={() => query.refetch()}
        />
      )}
    </>
  );
}
