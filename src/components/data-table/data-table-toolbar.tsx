"use client";

import { useId, useState } from "react";
import type { Table } from "@tanstack/react-table";
import { Bookmark, Columns3, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/components/providers/i18n-provider";
import { useSavedViews, type SavedViewState } from "./use-saved-views";
import {
  EXPORT_LIMIT,
  downloadCsv,
  downloadExcel,
  exportablePage,
  exportableRows,
  printRows,
  toTsv,
} from "./table-exports";

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The reference's DataTables toolbar: rows per page, Copy / CSV / Excel / PDF /
 * Print, search, and column visibility.
 *
 * With `loadAll`, every export is the whole set matching the current search
 * and filters (see table-exports.ts); without it, the page in hand, and the
 * screen-reader note says which. `onExport` is the older per-module CSV and is
 * used for CSV only when there is no `loadAll`.
 */
export function DataTableToolbar<TData>({
  table,
  viewsKey,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  onExport,
  loadAll,
  exportName = "records",
  children,
}: {
  table: Table<TData>;
  viewsKey?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  onExport?: () => void;
  loadAll?: () => Promise<{ rows: TData[]; total: number; refused: boolean }>;
  exportName?: string;
  children?: React.ReactNode;
}) {
  const { t, direction } = useI18n();
  const [newViewName, setNewViewName] = useState("");
  const [busy, setBusy] = useState(false);
  const scopeId = useId();
  const savedViews = useSavedViews(viewsKey ?? "");

  const currentState: SavedViewState = {
    sorting: table.getState().sorting,
    columnVisibility: table.getState().columnVisibility,
    columnFilters: table.getState().columnFilters,
  };

  /** The rows to export, or null when there is nothing to do (and why was said). */
  async function rowsToExport(): Promise<string[][] | null> {
    if (!loadAll) return exportablePage(table);
    setBusy(true);
    try {
      const result = await loadAll();
      if (result.refused) {
        toast.error(t("table.exportTooMany", { count: result.total, limit: EXPORT_LIMIT }));
        return null;
      }
      return exportableRows(table, result.rows);
    } catch (error) {
      toast.error(t("table.exportFailed", { message: error instanceof Error ? error.message : String(error) }));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const rows = await rowsToExport();
    if (!rows) return;
    try {
      await navigator.clipboard.writeText(toTsv(rows));
      toast.success(t("table.copied", { count: rows.length - 1 }));
    } catch {
      toast.error(t("table.copyDenied"));
    }
  }

  async function csv() {
    if (!loadAll && onExport) return onExport();
    const rows = await rowsToExport();
    if (rows) downloadCsv(rows, exportName);
  }

  async function excel() {
    const rows = await rowsToExport();
    if (rows) downloadExcel(rows, exportName);
  }

  async function print() {
    const rows = await rowsToExport();
    if (rows && !printRows(rows, t("table.printTitle"), direction)) toast.error(t("table.printBlocked"));
  }

  return (
    <div className="reference-table-toolbar" data-print="hide">
      <select
        aria-label={t("table.rowsPerPage")}
        className="h-[34px] rounded-none border border-input bg-card px-2 text-sm"
        value={table.getState().pagination.pageSize}
        onChange={(e) => table.setPageSize(Number(e.target.value))}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {t("table.showRows", { count: size })}
          </option>
        ))}
      </select>
      <div className="flex" role="group" aria-describedby={scopeId}>
        <Button variant="outline" size="sm" disabled={busy} onClick={copy}>
          {t("table.copy")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={csv}>
          {t("table.csv")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={excel}>
          {t("table.excel")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={print} title={t("table.pdfHint")}>
          {t("table.pdf")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={print}>
          {t("table.print")}
        </Button>
        {busy && <Loader2 className="ms-2 size-4 animate-spin self-center" aria-hidden="true" />}
      </div>
      <span id={scopeId} className="sr-only">
        {loadAll ? t("table.exportScopeAll") : t("table.exportScopePage")}
      </span>
      {children && <div className="flex flex-wrap items-center gap-2 px-2">{children}</div>}
      {onSearchChange && (
        <div className="reference-table-search relative">
          <span aria-hidden="true">{t("table.searchLabel")}</span>
          <Input
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? t("table.search")}
            className="pe-7"
            aria-label={searchPlaceholder ?? t("table.search")}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute top-1/2 end-2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={t("table.clearSearch")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center">
        {viewsKey && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Bookmark className="size-3.5" aria-hidden="true" />
                Views
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{t("table.savedViews")}</DropdownMenuLabel>
              {savedViews.views.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("table.noSavedViews")}</p>
              )}
              {savedViews.views.map((view) => (
                <DropdownMenuItem
                  key={view.name}
                  className="justify-between"
                  onSelect={(e) => {
                    e.preventDefault();
                    table.setSorting(view.state.sorting);
                    table.setColumnVisibility(view.state.columnVisibility);
                    table.setColumnFilters(view.state.columnFilters);
                  }}
                >
                  <span>{view.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      savedViews.remove(view.name);
                    }}
                    className="text-muted-foreground hover:text-destructive cursor-pointer"
                    aria-label={t("table.deleteView", { name: view.name })}
                  >
                    <X className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <div className="flex items-center gap-1 p-1.5">
                <Input
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder={t("table.nameThisView")}
                  className="h-8"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!newViewName.trim()}
                  onClick={() => {
                    savedViews.save(newViewName.trim(), currentState);
                    setNewViewName("");
                  }}
                >
                  {t("table.save")}
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="size-3.5" aria-hidden="true" />
              {t("table.columnVisibility")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {(column.columnDef.meta as { label?: string } | undefined)?.label ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
