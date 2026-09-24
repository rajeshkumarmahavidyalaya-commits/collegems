import Link from "next/link";
import { ArrowRight, CircleCheck, Circle, Rocket } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { SETUP_STEPS, parseSetupProgress, setupSentence } from "@/lib/validations/setup";

/**
 * "Get your college ready" -- the first-run steps whoever is signed in may act
 * on, from `setup_progress()` (0284). It draws nothing once every step is done,
 * and nothing for somebody who may act on none of them (a teacher, a family),
 * so it is a new college's card and not a fixture of every home page.
 */
export async function SetupChecklist() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("setup_progress");
  if (error) return null;
  const steps = parseSetupProgress(data);
  if (steps.length === 0 || steps.every((s) => s.done)) return null;

  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.key;

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Rocket className="size-4" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Get your college ready</CardTitle>
            <CardDescription>{setupSentence(steps)}</CardDescription>
          </div>
        </div>
        <div
          className="h-1.5 rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
        >
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y divide-border">
          {steps.map((s) => {
            const step = SETUP_STEPS[s.key];
            return (
              <li key={s.key} className="flex items-center gap-3 py-2.5">
                {s.done ? (
                  <CircleCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={s.done ? "text-sm text-muted-foreground line-through" : "text-sm font-medium"}>
                    {step.label}
                    <span className="sr-only">{s.done ? " (done)" : " (not done yet)"}</span>
                  </p>
                  {!s.done && <p className="text-xs text-muted-foreground">{step.hint}</p>}
                </div>
                {!s.done && (
                  <Link
                    href={step.href}
                    className={
                      "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (s.key === next ? "bg-primary text-primary-foreground hover:bg-primary/90" : "text-primary hover:bg-accent")
                    }
                  >
                    {s.key === next ? "Start" : "Open"}
                    <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
