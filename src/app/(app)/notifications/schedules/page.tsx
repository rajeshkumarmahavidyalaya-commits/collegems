import Link from "next/link";
import { AlarmClock, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { listRecentRuns, listScheduleProblems, listSchedules } from "./actions";
import { ScheduleCard } from "./schedule-card";
import { NewSchedule } from "./new-schedule";

export const metadata = { title: "Automatic messages" };

/**
 * What the school sends without anybody pressing anything.
 *
 * Two things this page is careful about, and both are the module's argument:
 *
 *   - **A schedule that runs is not a schedule that works.** The register says
 *     what ran; `schedule_problems()` says whether anybody heard. A school that
 *     switched SMS off and left the evening absence notice on gets a green
 *     "Ran · 40 matched" every night and forty skipped deliveries, so the
 *     critic's sentences sit next to the schedule rather than in a log.
 *   - **Turning one on never backfills.** Said on the page, next to the switch,
 *     because it is the first question anybody asks and the answer is not
 *     guessable.
 *
 * `schedules.manage` decides whether the switch and the *New schedule* button
 * are drawn. It is not the gate — `schedules` carries an admin-only ALL policy
 * — but the menu offers this screen to an accountant, and until now they were
 * shown every control and refused by Postgres on the click. Reading the
 * register is the half that is genuinely theirs: "did the fee reminder go out
 * on the 3rd" is a bursar's question.
 */
export default async function SchedulesPage() {
  const [schedules, runs, problems, canManage] = await Promise.all([
    listSchedules(),
    listRecentRuns(),
    listScheduleProblems(),
    hasPermission("schedules.manage"),
  ]);

  const enabled = schedules.filter((s) => s.isEnabled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Automatic messages</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Messages the school sends on its own. Each one runs on your school&rsquo;s clock, not
            the server&rsquo;s, and never twice for the same occurrence.
          </p>
        </div>
        {canManage && <NewSchedule />}
      </div>

      <Alert>
        <AlarmClock className="size-4" aria-hidden="true" />
        <AlertTitle>
          {enabled === 0
            ? "Nothing is switched on yet"
            : `${enabled} of ${schedules.length} switched on`}
        </AlertTitle>
        <AlertDescription>
          Switching one on does not send the occurrences it missed while it was off — it starts at
          the next one. A run that arrives later than its schedule allows is recorded as missed
          rather than sent late, because an absence notice at midnight is worse than none.{" "}
          <Link href="/reports" className="underline underline-offset-4">
            The full log
          </Link>{" "}
          is in the reports catalog.
        </AlertDescription>
      </Alert>

      {schedules.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No automatic messages</CardTitle>
            <CardDescription>
              Add one and it appears here with its next occurrence and what it did last time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canManage && <NewSchedule />}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              runs={runs.filter((r) => r.scheduleId === schedule.id).slice(0, 5)}
              problems={problems.filter((p) => p.scheduleId === schedule.id)}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-warning" aria-hidden="true" />
              Everything worth knowing
            </CardTitle>
            <CardDescription>
              Written by the database, not by this page — the thing that judges a schedule and the
              thing that runs it cannot drift.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {problems.map((problem, i) => (
              <div
                key={`${problem.scheduleId}-${i}`}
                className="flex items-start gap-2 rounded-md border p-3 text-sm"
              >
                {problem.severity === "error" ? (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                ) : problem.severity === "warning" ? (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span>
                  <span className="sr-only">
                    {problem.severity === "error"
                      ? "Error: "
                      : problem.severity === "warning"
                        ? "Warning: "
                        : "Note: "}
                  </span>
                  <Badge variant="outline" className="me-2">
                    {schedules.find((s) => s.id === problem.scheduleId)?.name ?? "Schedule"}
                  </Badge>
                  {problem.message}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
