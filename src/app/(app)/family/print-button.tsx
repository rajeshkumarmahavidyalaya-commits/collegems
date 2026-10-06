"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The browser's print dialog; the page's print stylesheet keeps only the sheet. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="cursor-pointer">
      <Printer className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
