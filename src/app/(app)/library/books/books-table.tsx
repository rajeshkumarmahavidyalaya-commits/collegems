"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { BookPlus } from "lucide-react";
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
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { listBooks, type BookRow } from "../actions";

const columns: ColumnDef<BookRow>[] = [
  {
    accessorKey: "title",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
    cell: ({ row }) => (
      <Link
        href={`/library/books/${row.original.id}`}
        className="font-medium underline-offset-4 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {row.original.title}
      </Link>
    ),
    meta: { label: "Title" },
  },
  {
    accessorKey: "author",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Author" />,
    meta: { label: "Author" },
  },
  {
    accessorKey: "categoryName",
    header: "Category",
    cell: ({ row }) =>
      row.original.categoryName ? (
        <Badge variant="secondary">{row.original.categoryName}</Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    enableSorting: false,
    meta: { label: "Category" },
  },
  {
    accessorKey: "isbn",
    header: "ISBN",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.isbn ?? "—"}</span>
    ),
    enableSorting: false,
    meta: { label: "ISBN" },
  },
  {
    accessorKey: "shelfLocation",
    header: "Shelf",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.shelfLocation ?? "—"}</span>
    ),
    enableSorting: false,
    meta: { label: "Shelf" },
  },
  {
    id: "availability",
    accessorKey: "available_copies",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Available" />,
    cell: ({ row }) => {
      const { availableCopies, totalCopies } = row.original;
      const allOut = availableCopies === 0;
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums">
            {availableCopies}/{totalCopies}
          </span>
          {allOut && <Badge variant="warning">All out</Badge>}
        </div>
      );
    },
    meta: { label: "Available" },
  },
];

export function BooksTable({
  categories,
  canManage,
}: {
  categories: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([{ id: "title", desc: false }]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const sortColumnMap: Record<string, string> = {
    title: "title",
    author: "author",
    availability: "available_copies",
  };

  const query = useQuery({
    queryKey: ["books", pageIndex, pageSize, sorting, search, categoryId],
    queryFn: () =>
      listBooks({
        pageIndex,
        pageSize,
        sortBy: sorting[0] ? sortColumnMap[sorting[0].id] : undefined,
        sortDesc: sorting[0]?.desc,
        search,
        categoryId: categoryId === "all" ? undefined : categoryId,
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
      onSortingChange={(next) => {
        setSorting(next);
        setPageIndex(0);
      }}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={setColumnVisibility}
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => query.refetch()}
      emptyTitle={search || categoryId !== "all" ? "No books match those filters" : "No books in the catalog yet"}
      emptyDescription={
        search || categoryId !== "all"
          ? "Try a different search term or clear the category filter."
          : "Add the first book to start lending."
      }
      emptyAction={
        canManage ? (
          <Button asChild size="sm">
            <Link href="/library/books/new">
              <BookPlus className="size-4" aria-hidden="true" />
              Add a book
            </Link>
          </Button>
        ) : undefined
      }
      onRowClick={(row) => router.push(`/library/books/${row.id}`)}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          viewsKey="library-books"
          searchValue={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPageIndex(0);
          }}
          searchPlaceholder="Search title, author, ISBN…"
          onExport={() =>
            exportRowsToCsv(
              (query.data?.rows ?? []) as unknown as Record<string, unknown>[],
              [
                { key: "title", label: "Title" },
                { key: "author", label: "Author" },
                { key: "categoryName", label: "Category" },
                { key: "isbn", label: "ISBN" },
                { key: "shelfLocation", label: "Shelf" },
                { key: "availableCopies", label: "Available" },
                { key: "totalCopies", label: "Total" },
              ],
              "schoolos-books.csv",
            )
          }
        >
          <Select
            value={categoryId}
            onValueChange={(v) => {
              setCategoryId(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[160px]" aria-label="Filter by category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DataTableToolbar>
      )}
    />
  );
}
