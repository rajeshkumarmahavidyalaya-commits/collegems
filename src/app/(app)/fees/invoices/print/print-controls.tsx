"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRINT_STATUSES, PRINT_STATUS_TEXT, type PrintStatus } from "./print-status";

/** Class and status, then the print. A filter is a link, so a print run can be bookmarked. */
export function PrintControls({
  sections,
  sectionId,
  status,
}: {
  sections: { id: string; label: string }[];
  sectionId: string;
  status: PrintStatus;
}) {
  const router = useRouter();
  const [section, setSection] = useState(sectionId);
  const [state, setState] = useState<PrintStatus>(status);
  const shown = section === sectionId && state === status && !!sectionId;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      <div className="flex min-w-48 flex-col gap-1.5">
        <Label htmlFor="print-class">Class</Label>
        <Select value={section} onValueChange={setSection}>
          <SelectTrigger id="print-class">
            <SelectValue placeholder="Choose a class" />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-40 flex-col gap-1.5">
        <Label htmlFor="print-status">Status</Label>
        <Select value={state} onValueChange={(v) => setState(v as PrintStatus)}>
          <SelectTrigger id="print-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRINT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PRINT_STATUS_TEXT[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        variant="outline"
        disabled={!section}
        onClick={() => router.push(`/fees/invoices/print?section=${section}&status=${state}`)}
      >
        <Search className="size-4" aria-hidden="true" />
        Show
      </Button>
      <Button disabled={!shown} onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden="true" />
        Print all
      </Button>
    </div>
  );
}
