import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { hasPermission } from "@/lib/auth/permissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { severityTone } from "@/lib/validations/promotion";
import { listRuns, listSessionProblems, listSessions } from "./actions";
import { listRenewalRuns } from "./renewals/actions";
import { RenewalLauncher } from "./renewals/renewal-launcher";
import { PromotionPlanner } from "./promotion-planner";

export const metadata = { title: "Promotion" };

export default async function PromotionPage() {
  const canManage = await hasPermission("promotion.manage");
  if (!canManage) redirect("/");

  const [sessions, runs, problems, renewalRuns] = await Promise.all([
    listSessions(),
    listRuns(),
    listSessionProblems(),
    listRenewalRuns(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Promotion</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Moving a whole school up a year. The rules produce a first answer; the preview is a set of
          rows you can change, and applying writes what the rows say — because every year there are
          three or four children the rules get wrong, and the person who knows that is standing at
          this screen.
        </p>
      </div>

      {problems.length > 0 && (
        <section aria-labelledby="rollover-problems-heading" className="flex flex-col gap-2">
          <h2 id="rollover-problems-heading" className="text-lg font-semibold">
            What the new year does not inherit
          </h2>
          <ul className="flex flex-col gap-2">
            {problems.map((problem, index) => (
              <li key={index}>
                <Alert>
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle className="flex items-center gap-2">
                    <Badge variant={severityTone(problem.severity)}>
                      {problem.severity === "warning" ? "Check this" : "Note"}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription>{problem.message}</AlertDescription>
                </Alert>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PromotionPlanner sessions={sessions} runs={runs} />

      <RenewalLauncher sessions={sessions} runs={renewalRuns} />
    </div>
  );
}
