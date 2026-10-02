import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Tone colours the icon and nothing else. A card never carries its meaning in
 * colour alone -- the number and the hint underneath say it in words, which is
 * what the checklist means by "badge/status meaning never relies on colour".
 */
export type StatTone = "default" | "warning" | "success" | "danger";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: StatTone;
}) {
  // The reference's horizontal card: a tinted icon tile, the label and hint,
  // and the figure at the end of the row.
  return (
    <Card className="reference-stat">
      <CardContent className="reference-stat-body">
        <span className={cn("reference-stat-icon", `reference-stat-${tone}`)}>
          <Icon aria-hidden="true" />
        </span>
        <div className="reference-stat-label">
          <p className="text-sm font-medium">{label}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="reference-stat-value tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
