import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon
          className={cn(
            "size-4",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success",
            tone === "danger" && "text-destructive",
            tone === "default" && "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </CardHeader>
      <CardContent>
        <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
