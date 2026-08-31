"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { FileX2, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTablePagination } from "./data-table-pagination";

export type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  totalCount: number;
  getRowId?: (row: TData) => string;

  pageIndex: number;
  pageSize: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;

  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;

  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;

  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;

  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;

  onRowClick?: (row: TData) => void;
  toolbar?: (table: ReturnType<typeof useReactTable<TData>>) => React.ReactNode;
  bulkActions?: (selectedRows: TData[]) => React.ReactNode;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  totalCount,
  getRowId,
  pageIndex,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  columnFilters,
  onColumnFiltersChange,
  rowSelection,
  onRowSelectionChange,
  isLoading,
  isError,
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Once records exist, they'll show up here.",
  emptyAction,
  onRowClick,
  toolbar,
  bulkActions,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
    getRowId,
    state: {
      pagination: { pageIndex, pageSize },
      sorting,
      columnVisibility: columnVisibility ?? {},
      columnFilters: columnFilters ?? [],
      rowSelection: rowSelection ?? {},
    },
    onSortingChange: (updater) => {
      onSortingChange(typeof updater === "function" ? updater(sorting) : updater);
    },
    onColumnVisibilityChange: (updater) => {
      onColumnVisibilityChange?.(
        typeof updater === "function" ? updater(columnVisibility ?? {}) : updater,
      );
    },
    onColumnFiltersChange: (updater) => {
      onColumnFiltersChange?.(
        typeof updater === "function" ? updater(columnFilters ?? []) : updater,
      );
    },
    onRowSelectionChange: (updater) => {
      onRowSelectionChange?.(
        typeof updater === "function" ? updater(rowSelection ?? {}) : updater,
      );
    },
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: !!onRowSelectionChange,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const columnCount = table.getVisibleLeafColumns().length;

  return (
    <div className="flex flex-col">
      {toolbar?.(table)}

      {bulkActions && selectedRows.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{selectedRows.length} selected</span>
          <div className="ml-auto flex items-center gap-2">{bulkActions(selectedRows)}</div>
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="bg-card">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: pageSize > 15 ? 8 : pageSize }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {Array.from({ length: columnCount }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-56 text-center">
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <FileX2 className="size-8 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Couldn&apos;t load this data</p>
                      <p className="text-sm text-muted-foreground">
                        Something went wrong on our end.
                      </p>
                    </div>
                    {onRetry && (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        Try again
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-56 text-center">
                  <div className="flex flex-col items-center justify-center gap-3 py-8">
                    <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="font-medium">{emptyTitle}</p>
                      <p className="text-sm text-muted-foreground">{emptyDescription}</p>
                    </div>
                    {emptyAction}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        pageIndex={pageIndex}
        pageSize={pageSize}
        totalCount={totalCount}
        selectedCount={selectedRows.length || undefined}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

export function exportRowsToCsv<TData extends Record<string, unknown>>(
  rows: TData[],
  columns: { key: keyof TData; label: string }[],
  filename: string,
) {
  const header = columns.map((c) => `"${c.label.replace(/"/g, '""')}"`).join(",");
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const value = row[c.key];
        const str = value === null || value === undefined ? "" : String(value);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
