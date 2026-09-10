import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { renewalKindLabel } from "@/lib/validations/renewals";
import {
  getRenewalDecisions,
  listRenewalRuns,
  listTargetRooms,
  listTargetStops,
} from "../actions";
import { RenewalReview } from "./renewal-review";

export const metadata = { title: "Carrying arrangements forward" };

export default async function RenewalRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const canManage = await hasPermission("promotion.manage");
  if (!canManage) redirect("/");

  const { runId } = await params;
  const [runs, decisions, stops, rooms, locale] = await Promise.all([
    listRenewalRuns(),
    getRenewalDecisions(runId),
    listTargetStops(runId),
    listTargetRooms(runId),
    getLocale(),
  ]);

  const run = runs.find((r) => r.id === runId);
  if (!run) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {renewalKindLabel(run.kind)} · {run.fromSessionName} → {run.toSessionName}
            </h1>
            <Badge variant={run.status === "applied" ? "default" : "outline"}>
              {run.status === "applied" ? "Applied" : "Draft"}
            </Badge>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {run.status === "applied"
              ? `Applied on ${formatDate(run.appliedAt, locale)} at ${formatTime(run.appliedAt, locale)}. This is the record of what happened.`
              : "An arrangement belongs to one academic year, so none of these carries itself. Change any row you disagree with, then apply."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/promotion">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            Rollover
          </Link>
        </Button>
      </div>

      <RenewalReview
        run={run}
        decisions={decisions}
        targets={run.kind === "transport" ? stops : rooms}
      />
    </div>
  );
}
