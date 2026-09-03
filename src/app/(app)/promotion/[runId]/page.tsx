import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { getRunDecisions, listRuns, listTargetSections } from "../actions";
import { RunReview } from "./run-review";

export const metadata = { title: "Promotion run" };

export default async function PromotionRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const canManage = await hasPermission("settings.manage");
  if (!canManage) redirect("/");

  const { runId } = await params;
  const [runs, decisions, sections] = await Promise.all([
    listRuns(),
    getRunDecisions(runId),
    listTargetSections(runId),
  ]);

  const run = runs.find((r) => r.id === runId);
  if (!run) notFound();

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
              ? `Applied on ${new Date(run.appliedAt!).toLocaleString("en-IN")}. This is the record of what happened.`
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

      <RunReview run={run} decisions={decisions} sections={sections} />
    </div>
  );
}
