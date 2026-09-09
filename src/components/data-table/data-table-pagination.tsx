"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/i18n-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DataTablePagination({
  pageIndex,
  pageSize,
  totalCount,
  selectedCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  isLoading,
}: {
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  selectedCount?: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
  /**
   * While a page is in flight, `totalCount` is 0 and the footer used to assert
   * **"No results"** underneath a skeleton — the table says "loading" and the
   * line beneath it says "there is nothing", and the second one is louder
   * because it is a sentence. `aria-live="polite"` announced it too.
   */
  isLoading?: boolean;
}) {
  const t = useT();
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(totalCount, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-col-reverse items-start gap-4 px-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground" aria-live="polite">
        {isLoading ? (
          t("table.loading")
        ) : selectedCount ? (
          t("table.selected", { count: String(selectedCount), total: String(totalCount) })
        ) : totalCount === 0 ? (
          t("table.noResults")
        ) : (
          t("table.showing", {
            from: String(from),
            to: String(to),
            total: String(totalCount),
          })
        )}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("table.rowsPerPage")}</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger size="sm" className="w-[70px]" aria-label={t("table.rowsPerPage")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {t("table.pageOf", { page: String(pageIndex + 1), pages: String(pageCount) })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(0)}
            disabled={pageIndex === 0}
            aria-label={t("table.firstPage")}
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(pageIndex - 1)}
            disabled={pageIndex === 0}
            aria-label={t("table.previousPage")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(pageIndex + 1)}
            disabled={pageIndex + 1 >= pageCount}
            aria-label={t("table.nextPage")}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(pageCount - 1)}
            disabled={pageIndex + 1 >= pageCount}
            aria-label={t("table.lastPage")}
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
