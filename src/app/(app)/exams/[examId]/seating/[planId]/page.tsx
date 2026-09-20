import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, DoorOpen, ListChecks } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSeatChart, getSeatPlan, listSeatingProblems } from "../../../seating-actions";
import { listClassRooms } from "../../../../academics/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import {
  byRoom,
  describeRules,
  PLAN_STATUS_LABEL,
  planStatusTone,
  severityTone,
  type PlanStatus,
} from "@/lib/validations/seating-display";
import { SeatChart } from "./seat-chart";

export const metadata = { title: "Seating plan" };

/**
 * One seating plan.
 *
 * Rule 13's editable preview: the rows *are* the deliverable, so there is no
 * apply step that writes them somewhere else — publishing freezes them, and
 * from that instant the candidates can see their own seat and nobody can edit
 * anything.
 *
 * The critic is read here rather than on a catalogue screen, because it takes a
 * plan id. A college-wide check that fired about an exam which finished in July
 * would be the critic that teaches people to ignore it.
 */
export default async function SeatPlanPage({
  params,
}: {
  params: Promise<{ examId: string; planId: string }>;
}) {
  const { examId, planId } = await params;
  const plan = await getSeatPlan(planId);
  if (!plan) notFound();

  const [chart, problems, rooms, canManage, locale] = await Promise.all([
    getSeatChart(planId),
    listSeatingProblems(planId),
    listClassRooms(),
    hasPermission("exams.manage"),
    getLocale(),
  ]);

  const rooms_ = byRoom(chart);
  const papers = new Set(chart.map((s) => s.paper)).size;
  const draft = plan.status === "draft";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/exams/${examId}/seating`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Seating
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {formatDate(plan.sitsOn, locale)}
          <Badge variant={planStatusTone(plan.status)}>
            {PLAN_STATUS_LABEL[plan.status as PlanStatus] ?? plan.status}
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {chart.length} candidate{chart.length === 1 ? "" : "s"} · {papers} paper
          {papers === 1 ? "" : "s"} · {rooms_.length} room{rooms_.length === 1 ? "" : "s"}
        </p>
        {/* Read from the plan's own frozen copy. A screen that re-read the
            tenant's current setting would show today's rules beside an
            arrangement made under last week's. */}
        <p className="mt-1 text-xs text-muted-foreground">{describeRules(plan.rules)}</p>
      </div>

      {draft ? (
        <Alert>
          <ListChecks className="size-4" aria-hidden="true" />
          <AlertTitle>Nobody has been told yet</AlertTitle>
          <AlertDescription>
            A draft is the school&apos;s own working copy. Move whoever needs moving, then publish —
            that is the act that lets each candidate and their family see their own seat, and
            nothing else.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <ListChecks className="size-4" aria-hidden="true" />
          <AlertTitle>Published</AlertTitle>
          <AlertDescription>
            Every candidate can now see their own seat and their family can see theirs. Reopening it
            withdraws that and lets the plan be edited again, which is why it is a deliberate act
            rather than a side effect of moving somebody.
          </AlertDescription>
        </Alert>
      )}

      {/* Three states, not two. `null` is "your role may not ask", an empty
          array is "asked, and there is nothing wrong". A screen that showed the
          same blank space for both would be the failure the critic exists to
          remove. */}
      {problems === null ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Checking a seating plan needs the <code>exams.manage</code> permission, so this list is
            not shown to your role.
          </CardContent>
        </Card>
      ) : problems.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What to look at</CardTitle>
            <CardDescription>Each one is something somebody has to do something about.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {problems.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Badge variant={severityTone(p.severity)} className="mt-0.5 shrink-0">
                  {p.severity}
                </Badge>
                <span>{p.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {rooms_.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DoorOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              This plan has no seats
            </CardTitle>
            <CardDescription>
              Nothing was written, which should not be possible — the generator refuses rather than
              saving a partial plan. Discard it and make it again.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <SeatChart
          planId={planId}
          status={plan.status}
          rooms={rooms_}
          allRooms={rooms.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity }))}
          canManage={canManage}
        />
      )}
    </div>
  );
}
