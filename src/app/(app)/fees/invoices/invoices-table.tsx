"use client";

import { useMemo, useState } from "react";
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
import { DataTable } from "@/components/data-table/data-table";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { loadAllPages } from "@/components/data-table/table-exports";

import { listInvoices, type InvoiceListRow } from "../actions";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * Built inside the component rather than at module scope, because the date
 * formatter is bound to the reader's locale and `useI18n()` has no component
 * to belong to out here. Everything else about the definition is unchanged.
 */
function invoiceColumns(
  formatDate: (value: string | Date | null | undefined) => string,
  formatCurrency: (value: number | string | null | undefined) => string,
): ColumnDef<InvoiceListRow>[] {
  // The reference's columns, in its order. Payable, Paid and Due use the
  // invoice page's own definitions (getInvoice), so the two cannot disagree.
  const money = (v: number) => <span className="font-mono tabular-nums">{formatCurrency(v)}</span>;
  return [
    {
      accessorKey: "studentName",
      header: "Student Name",
      cell: ({ row }) => <span className="font-medium">{row.original.studentName}</span>,
      enableSorting: false,
      meta: { label: "Student Name" },
    },
    {
      accessorKey: "admissionNumber",
      header: "Admission Number",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.admissionNumber}</span>,
      enableSorting: false,
      meta: { label: "Admission Number" },
    },
    {
      accessorKey: "number",
      header: "Invoice Number",
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
      meta: { label: "Invoice Number" },
    },
    {
      accessorKey: "total",
      header: "Payable",
      cell: ({ row }) => money(row.original.total),
      enableSorting: false,
      meta: { label: "Payable" },
    },
    {
      accessorKey: "paid",
      header: "Paid",
      cell: ({ row }) => money(row.original.paid),
      enableSorting: false,
      meta: { label: "Paid" },
    },
    {
      accessorKey: "due",
      header: "Due",
      cell: ({ row }) => money(row.original.due),
      enableSorting: false,
      meta: { label: "Due" },
    },
    {
      accessorKey: "status",
      header: "Status",
      // Text, never colour alone: the word is the meaning, the variant decoration.
      cell: ({ row }) => {
        const r = row.original;
        if (r.status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
        if (r.due <= 0) return <Badge variant="success">Paid</Badge>;
        if (r.paid > 0) return <Badge variant="warning">Partially Paid</Badge>;
        return <Badge variant="secondary">Unpaid</Badge>;
      },
      enableSorting: false,
      meta: { label: "Status" },
    },
    {
      accessorKey: "issueDate",
      header: "Date Issued",
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatDate(row.original.issueDate)}</span>,
      enableSorting: false,
      meta: { label: "Date Issued" },
    },
    {
      accessorKey: "dueDate",
      header: "Due Date",
      cell: ({ row }) => {
        const overdue =
          row.original.status === "issued" &&
          row.original.due > 0 &&
          row.original.dueDate < new Date().toISOString().slice(0, 10);
        return (
          <span className={overdue ? "font-medium whitespace-nowrap text-destructive tabular-nums" : "whitespace-nowrap tabular-nums"}>
            {formatDate(row.original.dueDate)}
          </span>
        );
      },
      enableSorting: false,
      meta: { label: "Due Date" },
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone ?? "—"}</span>,
      enableSorting: false,
      meta: { label: "Phone" },
    },
  ];
}

export function InvoicesTable() {
  const router = useRouter();
  const { formatDate, formatCurrency } = useI18n();
  const columns = useMemo(
    () => invoiceColumns(formatDate, formatCurrency),
    [formatDate, formatCurrency],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState("issued");
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const readPage = (page: number, size: number) =>
    listInvoices({
      pageIndex: page,
      pageSize: size,
      status,
      search,
    });

  const query = useQuery({
    queryKey: ["invoices", pageIndex, pageSize, status, search],
    queryFn: () => readPage(pageIndex, pageSize),
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
          loadAll={() => loadAllPages(readPage)}
          exportName="invoices"
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
