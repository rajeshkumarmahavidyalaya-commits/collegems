"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState, VisibilityState } from "@tanstack/react-table";
import { BookPlus, Pencil } from "lucide-react";
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
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { loadAllPages } from "@/components/data-table/table-exports";
import { listBooks, type BookRow } from "../actions";
import { IssueBookDialog } from "../issue-book-dialog";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * The reference's columns, in its order: Title, Author, Subject, Rack Number,
 * Book Number, ISBN Number, Price, Quantity, Issue Book, Action. "Subject" is
 * the book's category and "Rack Number" its shelf. Quantity shows what is on
 * the shelf against what the library holds, since that is the number a
 * librarian reads the list for.
 */
function bookColumns(
  formatCurrency: (v: number | null) => string,
  canManage: boolean,
  onIssued: () => void,
): ColumnDef<BookRow>[] {
  const dash = <span className="text-muted-foreground">—</span>;
  const cols: ColumnDef<BookRow>[] = [
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
      header: "Subject",
      cell: ({ row }) =>
        row.original.categoryName ? <Badge variant="secondary">{row.original.categoryName}</Badge> : dash,
      enableSorting: false,
      meta: { label: "Subject" },
    },
    {
      id: "shelf",
      accessorKey: "shelfLocation",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Rack Number" />,
      cell: ({ row }) =>
        row.original.shelfLocation ? <span className="font-mono text-xs">{row.original.shelfLocation}</span> : dash,
      meta: { label: "Rack Number" },
    },
    {
      id: "bookNumber",
      accessorKey: "bookNumber",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Book Number" />,
      cell: ({ row }) =>
        row.original.bookNumber ? <span className="font-mono text-xs">{row.original.bookNumber}</span> : dash,
      meta: { label: "Book Number" },
    },
    {
      accessorKey: "isbn",
      header: "ISBN Number",
      cell: ({ row }) => (row.original.isbn ? <span className="font-mono text-xs">{row.original.isbn}</span> : dash),
      enableSorting: false,
      meta: { label: "ISBN Number" },
    },
    {
      id: "price",
      accessorKey: "price",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Price" />,
      cell: ({ row }) =>
        row.original.price === null ? (
          dash
        ) : (
          <span className="font-mono tabular-nums">{formatCurrency(row.original.price)}</span>
        ),
      meta: { label: "Price" },
    },
    {
      id: "availability",
      accessorKey: "available_copies",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Quantity" />,
      cell: ({ row }) => {
        const { availableCopies, totalCopies } = row.original;
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono tabular-nums" title={`${availableCopies} on the shelf of ${totalCopies}`}>
              {availableCopies}/{totalCopies}
            </span>
            {availableCopies === 0 && <Badge variant="warning">All out</Badge>}
          </div>
        );
      },
      meta: { label: "Quantity" },
    },
  ];
  if (!canManage) return cols;
  return [
    ...cols,
    {
      id: "issue",
      header: "Issue Book",
      cell: ({ row }) =>
        row.original.availableCopies > 0 ? (
          <div onClick={(e) => e.stopPropagation()}>
            <IssueBookDialog
              book={{ id: row.original.id, title: row.original.title }}
              compact
              onIssued={onIssued}
            />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">None on the shelf</span>
        ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "action",
      header: "Action",
      cell: ({ row }) => (
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={`Edit ${row.original.title}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Link href={`/library/books/${row.original.id}/edit`}>
            <Pencil className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      ),
      enableSorting: false,
      enableHiding: false,
    },
  ];
}

export function BooksTable({
  categories,
  canManage,
}: {
  categories: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { formatCurrency } = useI18n();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sorting, setSorting] = useState<SortingState>([{ id: "title", desc: false }]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const sortColumnMap: Record<string, string> = {
    title: "title",
    author: "author",
    shelf: "shelf_location",
    bookNumber: "book_number",
    price: "price",
    availability: "available_copies",
  };

  const readPage = (page: number, size: number) =>
    listBooks({
      pageIndex: page,
      pageSize: size,
      sortBy: sorting[0] ? sortColumnMap[sorting[0].id] : undefined,
      sortDesc: sorting[0]?.desc,
      search,
      categoryId: categoryId === "all" ? undefined : categoryId,
    });

  const query = useQuery({
    queryKey: ["books", pageIndex, pageSize, sorting, search, categoryId],
    queryFn: () => readPage(pageIndex, pageSize),
    placeholderData: keepPreviousData,
  });
  const refetch = query.refetch;
  const columns = useMemo(
    () => bookColumns((v) => formatCurrency(v), canManage, () => void refetch()),
    [formatCurrency, canManage, refetch],
  );

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
          searchPlaceholder="Search title, author, ISBN, book number…"
          loadAll={() => loadAllPages(readPage)}
          exportName="books"
        >
          <Select
            value={categoryId}
            onValueChange={(v) => {
              setCategoryId(v);
              setPageIndex(0);
            }}
          >
            <SelectTrigger size="sm" className="w-[160px]" aria-label="Filter by subject">
              <SelectValue placeholder="All subjects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
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
