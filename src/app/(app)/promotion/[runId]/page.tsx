import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { getRunDecisions, listRuns, listTargetSections, previewLeftBehind } from "../actions";
import { RunReview } from "./run-review";

export const metadata = { title: "Promotion run" };

export default async function PromotionRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const canManage = await hasPermission("promotion.manage");
  if (!canManage) redirect("/");

  const { runId } = await params;
  const [runs, decisions, sections, locale] = await Promise.all([
    listRuns(),
    getRunDecisions(runId),
    listTargetSections(runId),
    getLocale(),
  ]);

  const run = runs.find((r) => r.id === runId);
  if (!run) notFound();

  // An applied run shows the record it froze; a draft is asked afresh, because
  // the point of knowing what cannot be closed is knowing it *before* applying.
  const leftBehind = run.status === "applied" ? run.leftBehind : await previewLeftBehind(runId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {run.fromSessionName} → {run.toSessionName}
            </h1>
            <Badge variant={run.status === "applied" ? "default" : "outline"}>
              {run.status === "applied" ? "Applied" : "Draft"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {run.status === "applied"
              ? `Applied on ${formatDate(run.appliedAt, locale)} at ${formatTime(run.appliedAt, locale)}. This is the record of what happened.`
              : "Nothing has been written yet. Change any row you disagree with, then apply."}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/promotion">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All runs
          </Link>
        </Button>
      </div>

      <RunReview run={run} decisions={decisions} sections={sections} leftBehind={leftBehind} />
    </div>
  );
}
