import Link from "next/link";
import { AlertTriangle, ArrowLeft, BadgePercent } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { severityTone } from "@/lib/validations/concessions";
import {
  listAwards,
  listConcessionProblems,
  listConcessions,
  listStudentsForConcession,
} from "./actions";
import { ConcessionsView } from "./concessions-view";

export const metadata = { title: "Concessions" };

/**
 * What this school takes off a bill, and for whom.
 *
 * The catalogue is readable by every tenant member — a family told they have
 * the sibling discount should be able to see what that means — but awarding one
 * is finance's, and the page gates the controls on `concessions.manage` while
 * RLS refuses the write regardless.
 */
export default async function ConcessionsPage() {
  const canManage = await hasPermission("concessions.manage");

  const [concessions, awards, problems, students] = await Promise.all([
    listConcessions(),
    listAwards(),
    listConcessionProblems(),
    canManage ? listStudentsForConcession() : Promise.resolve([]),
  ]);

  const live = awards.filter((a) => a.status === "active").length;
  const credited = awards.reduce((sum, a) => sum + a.credited, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/fees"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Fees
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Concessions</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Sibling discounts, staff wards, free seats and scholarships. A concession is granted to a
          named child for a stated reason, and comes off the next invoice automatically &mdash; the
          bill still shows the full charge, with the discount beside it.
        </p>
      </div>

      <Alert>
        <BadgePercent className="size-4" aria-hidden="true" />
        <AlertTitle>
          {live === 0
            ? "Nothing awarded yet"
            : `${live} live ${live === 1 ? "award" : "awards"}`}
        </AlertTitle>
        <AlertDescription>
          Percentages come off the original charge, so 10% and 50% together are 60% rather than
          55%. Fixed amounts come off what is left, and the total is never more than the bill.
          {credited > 0 && ` So far these have credited ${credited.toFixed(2)}.`}
        </AlertDescription>
      </Alert>

      {problems.length > 0 && (
        <section aria-labelledby="problems-heading" className="flex flex-col gap-2">
          <h2 id="problems-heading" className="text-lg font-semibold">
            Worth attending to
          </h2>
          <ul className="flex flex-col gap-2">
            {problems.map((problem, index) => (
              <li key={`${problem.studentId}-${index}`}>
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

      {concessions.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No concessions defined</CardTitle>
            <CardDescription>
              {canManage
                ? "Create one first — a sibling discount or a staff ward waiver — then award it to the children who qualify."
                : "Nobody has set up any concessions for this school yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <ConcessionsView
        concessions={concessions}
        awards={awards}
        students={students}
        canManage={canManage}
      />
    </div>
  );
}
