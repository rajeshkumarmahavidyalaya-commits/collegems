"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The browser's own print dialog, deliberately. Rendering a PDF is unbounded
 * work and belongs in `jobs` (CLAUDE.md rule 7); it is not built, and a button
 * that pretended otherwise would be the dishonest kind of feature. What this
 * does is real: the print stylesheet puts one child on one sheet.
 */
export function PrintButton({ count }: { count: number }) {
  return (
    <Button type="button" onClick={() => window.print()} className="cursor-pointer">
      <Printer className="size-4" aria-hidden="true" />
      Print {count} card{count === 1 ? "" : "s"}
    </Button>
  );
}
