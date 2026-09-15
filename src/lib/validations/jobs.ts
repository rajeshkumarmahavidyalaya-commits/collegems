import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * Background work — the display half.
 *
 * **No runtime imports**, deliberately, and `Translator` comes in as a *type*.
 * This is `fees-display.ts`'s rule and its warning applies verbatim: one
 * `import { z }` and it silently becomes the thing it was extracted from,
 * charging every route that renders a job badge for the whole of Zod.
 */

export const JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "refused",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Waiting",
  processing: "Running",
  completed: "Done",
  failed: "Stopped",
  // Not "Cancelled": a refusal covers both somebody pressing Stop *and* a
  // permission that changed underneath the job. The reason on the row says
  // which, and the badge deliberately does not guess.
  refused: "Stopped",
};

export function jobStatusLabel(status: string, t: Translator): string {
  const known = JOB_STATUS_LABEL[status as JobStatus];
  return known ? labelFor(`jobs.status.${status}`, known, t) : status;
}

export function jobStatusTone(status: string): "success" | "warning" | "destructive" | "secondary" {
  if (status === "completed") return "success";
  if (status === "failed") return "destructive";
  if (status === "refused") return "warning";
  return "secondary";
}

/** A job that is still going is one somebody may stop, and one worth polling for. */
export function isJobLive(status: string): boolean {
  return status === "queued" || status === "processing";
}

/**
 * What a job's row says it is doing, in one sentence.
 *
 * The register's own note wins when there is one, exactly as `runSentence` does
 * for a schedule: the database wrote it knowing what the work was, and a screen
 * paraphrasing that is a second answer to a question that already has one.
 *
 * The interesting case is `queued` **after** progress — which is the whole
 * module. A job that has done 200 of 250 and gone back on the queue is not
 * "waiting"; it is *carrying on*, and saying "waiting" would put the office
 * back where they started, wondering whether to press something.
 */
export function jobSentence(
  job: { status: string; progressDone: number; progressNote: string | null; error: string | null },
  t: Translator,
): string {
  if (job.status === "failed" || job.status === "refused") {
    return job.error ?? labelFor("jobs.sentence.stopped", "It stopped, and no reason was recorded.", t);
  }
  if (job.status === "completed") {
    return job.progressNote ?? labelFor("jobs.sentence.done", "Finished.", t);
  }
  if (job.status === "processing") {
    return job.progressNote ?? labelFor("jobs.sentence.running", "Running now.", t);
  }
  // queued
  if (job.progressDone > 0) {
    return job.progressNote ?? labelFor("jobs.sentence.carryingOn", "Carrying on.", t);
  }
  return labelFor("jobs.sentence.queued", "Waiting to start. It begins within a minute.", t);
}
