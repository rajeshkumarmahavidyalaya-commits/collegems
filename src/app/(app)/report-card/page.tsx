import Link from "next/link";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getUserContext } from "@/lib/auth/context";
import { formatPercent, resultLabel } from "@/lib/validations/exams";
import { ordinal } from "@/lib/validations/report-cards";
import { listMyChildren, listPublishedResults } from "../exams/report-card-actions";

export const metadata = { title: "Report cards" };

/**
 * The family's side. A parent with three children sees three lists; a student
 * sees their own. Only published results appear, and that is RLS doing it --
 * `exam_results` has no row for a draft exam at all, so there is nothing here
 * to filter and nothing to leak.
 */
export default async function FamilyReportCardsPage() {
  const ctx = await getUserContext();
  const children = await listMyChildren();

  if (!ctx || (ctx.roleCode !== "parent" && ctx.roleCode !== "student")) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Report cards</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            This page shows a family their own children&apos;s cards. To print a class&apos;s cards,
            open the exam and choose <span className="font-medium">Report cards</span>.
          </p>
        </div>
      </div>
    );
  }

  const lists = await Promise.all(
    children.map(async (child) => ({
      child,
      results: await listPublishedResults(child.studentId),
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Report cards</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every result the school has published. A card here is the one that was handed out — it
          does not change afterwards.
        </p>
      </div>

      {lists.length === 0 ? (
        <EmptyState
          title="No children linked to this login"
          body="Ask the school office to link your account to your child's record."
        />
      ) : (
        lists.map(({ child, results }) => (
          <section key={child.studentId} className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">{child.name}</h2>
            {results.length === 0 ? (
              <EmptyState
                title="Nothing published yet"
                body="When the school publishes an exam's results, the card appears here."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {results.map((result) => (
                  <li key={result.examId}>
                    <Link
                      href={`/report-card/${child.studentId}/${result.examId}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 transition-colors duration-200 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div>
                        <p className="font-medium">{result.examName}</p>
                        <p className="text-sm text-muted-foreground">
                          {result.publishedAt
                            ? `Published ${new Date(result.publishedAt).toLocaleDateString()}`
                            : "Published"}
                          {result.rankInCohort && result.cohortSize
                            ? ` · ${ordinal(result.rankInCohort)} of ${result.cohortSize}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono tabular-nums">
                          {formatPercent(result.percentage)}
                        </span>
                        {result.grade ? (
                          <span className="font-mono text-muted-foreground">{result.grade}</span>
                        ) : null}
                        <Badge
                          variant={
                            result.result === "fail"
                              ? "destructive"
                              : result.result === "incomplete"
                                ? "secondary"
                                : "default"
                          }
                        >
                          {resultLabel(result.result)}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
      <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
