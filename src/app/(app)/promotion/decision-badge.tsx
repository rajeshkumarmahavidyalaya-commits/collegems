"use client";

import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  decisionLabel,
  decisionTone,
} from "@/lib/validations/promotion-display";

/*
 * Its own module because the run screen draws it too, and importing it from
 * `promotion-planner.tsx` brought the planner's form and Zod with it: an
 * import charges for the module, not for the one export (docs/performance.md).
 */

export function DecisionBadge({ decision }: { decision: string }) {
  const { t } = useI18n();
  const tone = decisionTone(decision);
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal",
        tone === "success" &&
          "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
        tone === "warning" &&
          "border-amber-600/40 text-amber-700 dark:text-amber-400",
        tone === "info" && "border-sky-600/40 text-sky-700 dark:text-sky-400",
      )}
    >
      {decision === "promote" && (
        <CheckCircle2 className="size-3" aria-hidden="true" />
      )}
      {decisionLabel(decision, t)}
    </Badge>
  );
}
