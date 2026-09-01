"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { FileText } from "lucide-react";
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
import { listInvoices, type InvoiceListRow } from "../actions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const columns: ColumnDef<InvoiceListRow>[] = [
  {
    accessorKey: "number",
    header: "Invoice",
    cell: ({ row }) => (
      <Link
        href={`/fees/invoices/${row.original.id}`}
        className="font-mono text-xs underline-offset-4 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.original.number}
      </Link>
    ),
    enableSorting: false,
    meta: { label: "Invoice" },
  },
  {
    accessorKey: "studentName",
    header: "Student",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.studentName}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.admissionNumber}
        </span>
      </div>
    ),
    enableSorting: false,
    meta: { label: "Student" },
  },
  {
    accessorKey: "issueDate",
    header: "Issued",
    cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.issueDate)}</span>,
    enableSorting: false,
    meta: { label: "Issued" },
  },
  {
    accessorKey: "dueDate",
    header: "Due",
    cell: ({ row }) => {
      const overdue =
        row.original.status === "issued" &&
        row.original.dueDate < new Date().toISOString().slice(0, 10);
      return (
        <span className={overdue ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>
          {formatDate(row.original.dueDate)}
        </span>
      );
    },
    enableSorting: false,
    meta: { label: "Due" },
  },
  {
    accessorKey: "total",
    header: "Amount",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">{formatMoney(row.original.total)}</span>
    ),
    enableSorting: false,
    meta: { label: "Amount" },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) =>
      row.original.status === "cancelled" ? (
        <Badge variant="outline">Cancelled</Badge>
      ) : (
        <Badge variant="secondary">Issued</Badge>
      ),
    enableSorting: false,
    meta: { label: "Status" },
  },
];

export function InvoicesTable() {
  const router = useRouter();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("issued");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const query = useQuery({
    queryKey: ["invoices", pageIndex, pageSize, status, search],
    queryFn: () => listInvoices({ pageIndex, pageSize, status, search }),
    placeholderData: keepPreviousData,
  });

  const filtered = status !== "issued" || search !== "";

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
      emptyTitle={filtered ? "No invoices match those filters" : "No invoices raised yet"}
      emptyDescription={
        filtered
          ? "Try a different invoice number, or show cancelled ones too."
          : "Raise them for a whole class from fee setup, or one at a time from the counter."
      }
      emptyAction={
        !filtered ? (
          <Button asChild size="sm">
            <Link href="/fees/setup">
              <FileText className="size-4" aria-hidden="true" />
              Raise invoices
            </Link>
          </Button>
        ) : undefined
      }
      onRowClick={(row) => router.push(`/fees/invoices/${row.id}`)}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          viewsKey="invoices"
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          searchPlaceholder="Search invoice number…"
          onExport={() =>
            exportRowsToCsv(
              (query.data?.rows ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "number", label: "Invoice" },
                { key: "admissionNumber", label: "Admission no." },
                { key: "studentName", label: "Student" },
                { key: "issueDate", label: "Issued" },
                { key: "dueDate", label: "Due" },
                { key: "total", label: "Amount" },
                { key: "status", label: "Status" },
              ],
              "schoolos-invoices.csv",
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
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </DataTableToolbar>
      )}
    />
  );
}
