import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import {
  actionLabel,
  actionTone,
  actorIsPerson,
  entrySummary,
  fieldLabel,
  formatAuditValue,
  parseChangedFields,
} from "@/lib/validations/audit";

/**
 * What happened to one row, shown beside the row.
 *
 * **Gated on `audit.view`, and the gate is not decoration.** `audit_history` is
 * `SECURITY INVOKER` over an admin-only policy, so a teacher calling it gets
 * back an empty list rather than an error — which would render as a panel
 * saying nothing ever happened to a certificate that has been cancelled twice.
 * That is migration 0158's lesson: an invoker function over a policy the caller
 * fails answers them with a plausible zero, so the page must not ask.
 */
export async function AuditTrail({
  table,
  rowId,
  limit = 20,
  title = "History",
}: {
  table: string;
  rowId: string;
  limit?: number;
  title?: string;
}) {
  if (!(await hasPermission("audit.view"))) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("audit_history", {
    p_table_name: table,
    p_row_id: rowId,
    p_limit: limit,
  });

  const entries = data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardDescription>
          Every change recorded against this record, newest first. &ldquo;System&rdquo; means
          nobody was signed in &mdash; a background job or imported data.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet. Changes appear here as soon as anybody makes one.
          </p>
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.map((entry) => {
              const changes = parseChangedFields(entry.changed_fields);
              return (
                <li key={entry.id} className="border-s-2 border-border ps-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={actionTone(entry.action)}>{actionLabel(entry.action)}</Badge>
                    <span
                      className={
                        actorIsPerson(entry.actor ?? "")
                          ? "text-sm font-medium"
                          : "text-sm font-medium text-muted-foreground"
                      }
                    >
                      {entry.actor}
                    </span>
                    <time
                      dateTime={entry.changed_at ?? undefined}
                      className="text-xs text-muted-foreground"
                    >
                      {entry.changed_at?.replace("T", " ").slice(0, 16)}
                    </time>
                  </div>

                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {entrySummary({
                      action: entry.action,
                      fieldCount: entry.field_count ?? 0,
                    })}
                  </p>

                  {entry.action === "update" && changes.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {changes.map((change) => (
                        <li key={change.field} className="text-sm">
                          <span className="text-muted-foreground">{fieldLabel(change.field)}</span>{" "}
                          <span className="line-through decoration-muted-foreground/50">
                            {formatAuditValue(change.from)}
                          </span>{" "}
                          <span aria-hidden="true" className="text-muted-foreground">
                            &rarr;
                          </span>{" "}
                          <span className="font-medium">{formatAuditValue(change.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
