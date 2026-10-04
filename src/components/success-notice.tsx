import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The success message after a server action that ends in a redirect. A toast
 * cannot survive a redirect, and a form that simply vanishes into another
 * page reads as "did that work?" -- which is what a college told us adding a
 * school looked like. `role="status"` so a screen reader announces it.
 */
export function SuccessNotice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
      <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
