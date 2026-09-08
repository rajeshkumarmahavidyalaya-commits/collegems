import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleCheck, EyeOff, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  attentionCount,
  checkStatusLabel,
  checkTone,
  severityTone,
} from "@/lib/validations/checks";
import { listChecks } from "./actions";

export const metadata = { title: "Needs attention" };

export default async function ChecksPage() {
  const groups = await listChecks();

  const attention = groups.filter((g) => g.status === "attention" || g.status === "error");
  const clean = groups.filter((g) => g.status === "ok");
  const withheld = groups.filter((g) => g.status === "withheld");
  const total = attentionCount(groups);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Needs attention</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every check this school runs against its own data, in one place. Each one lives beside the
          screen that fixes it — this page exists because a check nobody visits is a check nobody
          reads.
        </p>
      </div>

      {attention.length === 0 ? (
        <Alert>
          <CircleCheck className="size-4" aria-hidden="true" />
          <AlertTitle>
            {clean.length === 0
              ? "Nothing here is yours to see"
              : `${clean.length} ${clean.length === 1 ? "check" : "checks"} ran and found nothing`}
          </AlertTitle>
          <AlertDescription>
            {clean.length === 0
              ? "Every check is gated on what your role may act on, and none of them is."
              : "Checks are quiet by design: each one speaks only when somebody has to do something about it."}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {total} {total === 1 ? "thing" : "things"} across{" "}
            {attention.length} {attention.length === 1 ? "check" : "checks"}
          </AlertTitle>
          <AlertDescription>
            Nothing here is an error in the software. Each line is something about this school&rsquo;s
            data that somebody has to decide about.
          </AlertDescription>
        </Alert>
      )}

      {attention.length > 0 && (
        <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
          <h2 id="attention-heading" className="sr-only">
            Checks that found something
          </h2>
          {attention.map((group) => (
            <Card key={group.key}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {group.label}
                      <Badge variant={checkTone(group.status)}>
                        {checkStatusLabel(group.status)}
                      </Badge>
                      <Badge variant="outline">{group.module}</Badge>
                    </CardTitle>
                    <CardDescription className="max-w-2xl">{group.description}</CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={group.href}>
                      Go and fix it
                      <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {group.problems.map((problem, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm">
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="flex flex-wrap items-baseline gap-2">
                        <Badge variant={severityTone(problem.severity)}>
                          {problem.severity === "error"
                            ? "Broken"
                            : problem.severity === "warning"
                              ? "Check this"
                              : "Note"}
                        </Badge>
                        <span>{problem.message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {clean.length > 0 && (
        <section aria-labelledby="clean-heading" className="flex flex-col gap-2">
          <h2 id="clean-heading" className="text-lg font-semibold">
            Ran and found nothing
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {clean.map((group) => (
              <li
                key={group.key}
                className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <CircleCheck className="size-4 text-success" aria-hidden="true" />
                  <Link href={group.href} className="underline-offset-4 hover:underline">
                    {group.label}
                  </Link>
                </span>
                <Badge variant="outline">{group.module}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {withheld.length > 0 && (
        <section aria-labelledby="withheld-heading" className="flex flex-col gap-2">
          <h2 id="withheld-heading" className="text-lg font-semibold">
            Not shown to your role
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            These are named rather than hidden: a check that is simply absent reads as one that
            passed. Some of them ask which rows are <em>missing</em>, and that is a question only
            somebody who can see every row can answer — see the note in migration 0189.
          </p>
          <ul className="flex flex-wrap gap-2">
            {withheld.map((group) => (
              <li key={group.key}>
                <Badge variant="secondary" className="gap-1">
                  <EyeOff className="size-3.5" aria-hidden="true" />
                  {group.label}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
