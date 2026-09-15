"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * `window.print()` and nothing else. The certificate is already a document on
 * the page — the print stylesheet in `globals.css` drops the app chrome — and a
 * school wants this on their own letterhead in their own printer tray.
 *
 * This used to end *"so there is no PDF to render and no job to queue"*, which
 * was a claim about **printing** standing in for a claim about **sending**.
 * They fail in opposite directions, so both are kept and the page offers both:
 *
 *   - printing renders in the reader's browser with the reader's system fonts,
 *     so it prints Devanagari and Urdu that `src/lib/pdf` cannot — and produces
 *     nothing anybody can attach to an email;
 *   - the PDF beside it is a file, and is Latin-script only.
 *
 * A comment that answers the question somebody was about to ask is worse than
 * no comment when it answers a slightly different one.
 */
export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden="true" />
      Print
    </Button>
  );
}
