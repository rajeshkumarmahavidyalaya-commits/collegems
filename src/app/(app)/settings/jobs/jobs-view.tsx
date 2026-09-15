"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  isJobLive,
  jobSentence,
  jobStatusLabel,
  jobStatusTone,
} from "@/lib/validations/jobs";
import { startJob, stopJob, type JobKind, type JobRow } from "./actions";

/**
 * What the school has running.
 *
 * The one piece of behaviour worth explaining is the refresh. A job that is
 * still going changes underneath this page a minute at a time, and a screen
 * that shows *"200 of 250"* for ever is the press-it-again problem wearing a
 * progress note. So the page refreshes itself **only while something is live**
 * and stops the moment nothing is — a poll that runs on an idle screen is a
 * query per office per ten seconds, for ever, to watch nothing happen.
 */
export function JobsView({ jobs, kinds }: { jobs: JobRow[]; kinds: JobKind[] }) {
  const { t, formatDateTime } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const live = jobs.some((j) => isJobLive(j.status));

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [live, router]);

  function start(kind: string) {
    setBusy(kind);
    startTransition(async () => {
      const result = await startJob(kind);
      setBusy(null);
      if (result.ok) {
        toast.success("Started. It runs on its own — you can leave this page.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function stop(id: string) {
    startTransition(async () => {
      const result = await stopJob(id);
      if (result.ok) {
        toast.success("Stopped. What was already done stays done.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {kinds.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Start something</CardTitle>
            <CardDescription>
              These run in the background, a page at a time, and keep going until they are
              finished. You do not have to stay on this screen.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {kinds.map((kind) => (
              <div
                key={kind.key}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 max-w-2xl">
                  <p className="text-sm font-medium">{kind.label}</p>
                  <p className="text-xs text-muted-foreground">{kind.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => start(kind.key)}
                >
                  <Play className="size-3.5" aria-hidden="true" />
                  {busy === kind.key ? "Starting…" : "Start"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent</CardTitle>
          <CardDescription>
            Newest first. A job that stopped keeps its reason — &ldquo;why did nothing
            happen&rdquo; has to have an answer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has run in the background yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-2" aria-live="polite">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border p-3 text-sm"
                >
                  <Badge variant={jobStatusTone(job.status)}>
                    {jobStatusLabel(job.status, t)}
                  </Badge>
                  <span className="font-medium">{job.kindLabel}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDateTime(job.createdAt)}
                  </span>
                  <span className="w-full text-muted-foreground sm:w-auto sm:flex-1">
                    {jobSentence(job, t)}
                  </span>
                  {isJobLive(job.status) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => stop(job.id)}
                    >
                      <Square className="size-3.5" aria-hidden="true" />
                      Stop
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
