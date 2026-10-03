"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv } from "@/components/data-table/table-exports";

/** The reference's Export: the rows the person is looking at, as CSV. */
export function ExportRowsButton({ rows, fileName }: { rows: string[][]; fileName: string }) {
  function download() {
    const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button type="button" variant="outline" onClick={download} disabled={rows.length <= 1} className="cursor-pointer">
      <Download className="size-4" aria-hidden="true" />
      Export
    </Button>
  );
}
