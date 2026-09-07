"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * `window.print()` and nothing else. The certificate is already a document on
 * the page — the print stylesheet in `globals.css` drops the app chrome — so
 * there is no PDF to render and no job to queue. That is deliberate: a school
 * wants this on their own letterhead in their own printer tray.
 */
export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" />
      Print
    </Button>
  );
}
