"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Clock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  setScheduleEnabled,
  type RunRow,
  type SchedulableReport,
  type ScheduleProblem,
  type ScheduleRow,
} from "./actions";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  graceSentence,
  kindLabel,
  runSentence,
  runStatusTone,
  RUN_STATUS_LABEL,
  reportKeyOf,
  scheduleSentence,
  type RunStatus,
  kindDescription,
} from "@/lib/validations/schedules";

export function ScheduleCard({
  schedule,
  runs,
  problems,
  reports,
  canManage,
}: {
  schedule: ScheduleRow;
  runs: RunRow[];
  problems: ScheduleProblem[];
  /** The reports this viewer may run — the key-to-name lookup, and only that. */
  reports: SchedulableReport[];
  /** Whether the caller holds `schedules.manage`. The switch is theirs; the register is everybody's. */
  canManage: boolean;
}) {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    startTransition(async () => {
      const result = await setScheduleEnabled(schedule.id, next);
      if (result.ok) {
        toast.success(
          next
            ? `${schedule.name} is on. It starts at its next occurrence — nothing missed is sent.`
            : `${schedule.name} is off.`,
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const blocking = problems.filter((p) => p.severity !== "info");

  // A digest names a report. The viewer may not be able to run it — a colleague
  // scheduled it — in which case the key is shown rather than a guess at the
  // name: *there is no such report for me* and *this report is called something
  // else* are different facts and one of them is not this card's to invent.
  const reportKey = reportKeyOf(schedule);
  const reportName = reportKey ? (reports.find((r) => r.key === reportKey)?.name ?? null) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {schedule.name}
              <Badge variant="outline">{kindLabel(schedule.kind, t)}</Badge>
              {!schedule.isEnabled && <Badge variant="secondary">Off</Badge>}
              {blocking.length > 0 && schedule.isEnabled && (
                <Badge variant="warning">
                  <TriangleAlert className="size-3" aria-hidden="true" />
                  Needs attention
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {kindDescription(schedule.kind, t)}
            </CardDescription>
            {reportKey && (
              <CardDescription className="mt-1">
                Runs{" "}
                {reportName ? (
                  <strong className="font-medium text-foreground">{reportName}</strong>
                ) : (
                  <code className="font-mono text-xs">{reportKey}</code>
                )}
                .
              </CardDescription>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor={`enabled-${schedule.id}`} className="text-sm">
              {schedule.isEnabled ? "On" : "Off"}
            </Label>
            <Switch
              id={`enabled-${schedule.id}`}
              checked={schedule.isEnabled}
              disabled={pending || !canManage}
              onCheckedChange={toggle}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <AlarmClock className="size-3.5" aria-hidden="true" />
            {scheduleSentence({
              run_at: schedule.runAt,
              weekdays: schedule.weekdays,
              day_of_month: schedule.dayOfMonth,
            }, t)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" />
            {graceSentence(schedule.graceMinutes, t)}
          </span>
        </div>

        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No occurrences yet.{" "}
            {schedule.isEnabled
              ? "The next one will appear here once it has run."
              : "It will start at its next occurrence after you switch it on."}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border p-3 text-sm"
              >
                <Badge variant={runStatusTone(run.status)}>
                  {RUN_STATUS_LABEL[run.status as RunStatus] ?? run.status}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDateTime(run.occurrenceAt)}
                </span>
                <span className="text-muted-foreground">
                  {runSentence(run, schedule.kind)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
