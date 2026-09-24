"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Circle, Clock, CopyPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { yearEndSteps, type Step, type YearEnd } from "@/lib/validations/year-end";
import { rollForwardSections } from "../../promotion/actions";
import { copyFeeStructures } from "./actions";

/**
 * Turning the year over, in the order it has to happen. The switch is the last
 * step and says what it would leave behind, rather than being the first button
 * on the screen (0276).
 */
export function YearEndChecklist({
  yearEnd,
  stale,
  onSwitch,
}: {
  yearEnd: YearEnd;
  /** The current year has already ended, so this is overdue rather than early. */
  stale: boolean;
  onSwitch: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const steps = yearEndSteps(yearEnd);
  const from = yearEnd.from;
  const to = yearEnd.to!;
  const done = steps.filter((s) => s.state === "done").length;

  function copyClasses() {
    if (!from) return;
    startTransition(async () => {
      const r = await rollForwardSections(from.id, to.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        r.data.created === 0
          ? `Every class already exists in ${to.name}.`
          : `Copied ${r.data.created} ${r.data.created === 1 ? "class" : "classes"} into ${to.name}.`,
      );
      router.refresh();
    });
  }

  function copyFees() {
    if (!from) return;
    startTransition(async () => {
      const r = await copyFeeStructures(from.id, to.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        r.data.created === 0
          ? `Every fee already exists in ${to.name}.`
          : `Copied ${r.data.created} ${r.data.created === 1 ? "fee" : "fees"} into ${to.name}. Check the amounts once the year has changed.`,
      );
      router.refresh();
    });
  }

  function action(step: Step) {
    if (step.state !== "todo") return null;
    switch (step.key) {
      case "classes":
        return yearEnd.classes.from > 0 ? (
          <Button size="sm" variant="outline" onClick={copyClasses} disabled={pending}>
            <CopyPlus className="size-4" aria-hidden="true" />
            Copy {from?.name}&rsquo;s classes
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href="/academics">Set up classes</Link>
          </Button>
        );
      case "fees":
        return yearEnd.fees.from > 0 ? (
          <Button size="sm" variant="outline" onClick={copyFees} disabled={pending}>
            <CopyPlus className="size-4" aria-hidden="true" />
            Copy {from?.name}&rsquo;s fees
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href="/fees/setup">Fee setup</Link>
          </Button>
        );
      case "promote":
        return (
          <Button size="sm" variant="outline" asChild>
            <Link
              href={
                yearEnd.children.draftRun ? `/promotion/${yearEnd.children.draftRun}` : "/promotion"
              }
            >
              {yearEnd.children.draftRun ? "Open the draft run" : "Start a promotion"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        );
      case "renew":
        return (
          <Button size="sm" variant="outline" asChild>
            <Link href="/promotion#renewals">
              Carry them across
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        );
      case "switch":
        return (
          <Button
            size="sm"
            variant={yearEnd.children.waiting > 0 ? "outline" : "default"}
            onClick={onSwitch}
            disabled={pending}
          >
            Make {to.name} current
          </Button>
        );
    }
  }

  return (
    <Card className={stale ? "border-destructive/40" : undefined}>
      <CardHeader>
        <CardTitle className="text-base">
          Moving from {from?.name ?? "this year"} to {to.name}
        </CardTitle>
        <CardDescription>
          {stale && from
            ? `${from.name} has ended and is still the current year, so everything written since is filed under it. Work through these in order; switching is the last step. `
            : "Work through these in order; switching is the last step. "}
          {done} of {steps.length} done.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3" aria-busy={pending}>
          {steps.map((step, i) => (
            <li key={step.key} className="flex gap-3 rounded-lg border border-border p-3">
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                {step.state === "done" ? (
                  <CheckCircle2 className="size-5 text-success" />
                ) : step.state === "later" ? (
                  <Clock className="size-5 text-muted-foreground" />
                ) : pending ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                ) : (
                  <Circle className="size-5 text-muted-foreground" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    {i + 1}. {step.title}{" "}
                    <span className="sr-only">
                      {step.state === "done" ? "(done)" : step.state === "later" ? "(later)" : "(to do)"}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                </div>
                <div className="shrink-0">{action(step)}</div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
