"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/i18n-provider";
import { SETUP_STEPS, stepCount, type SetupStep } from "@/lib/validations/setup";

/**
 * The reference's step-by-step setup screen over `setup_progress()` (0284):
 * the steps, their order and whether each is done are the database's answer,
 * for the steps this person may act on. Nothing is ticked here -- a step is
 * done when the school's records say so, and "Configure step" opens the real
 * screen where it is done.
 */
export function SetupWizard({ steps }: { steps: SetupStep[] }) {
  const t = useT();
  const [selected, setSelected] = useState(() => Math.max(0, steps.findIndex((s) => !s.done)));
  const done = steps.filter((s) => s.done).length;
  const current = steps[selected];
  if (!current) {
    return <p className="rounded-md border p-6 text-muted-foreground">{t("setup.noSteps")}</p>;
  }
  const definition = SETUP_STEPS[current.key];
  const percent = Math.round((done / steps.length) * 100);
  const count = stepCount(current);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between text-sm">
        <span>{t("setup.stepOf", { n: selected + 1, total: steps.length })}</span>
        <span className="font-medium text-primary">{t("setup.percent", { percent })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("setup.progress")}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        className="h-2 rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <nav aria-label={t("setup.steps")} className="rounded-md border bg-card p-4">
          <h2 className="mb-3 font-semibold">{t("setup.steps")}</h2>
          <ol className="flex flex-col gap-1">
            {steps.map((step, i) => (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-current={selected === i ? "step" : undefined}
                  className={`flex w-full items-center gap-3 rounded-md p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected === i ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${
                      step.done ? "bg-primary text-primary-foreground" : "border"
                    }`}
                  >
                    {step.done ? <Check className="size-4" aria-hidden="true" /> : i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{SETUP_STEPS[step.key].label}</span>
                    {step.done && <span className="text-xs">{t("setup.completed")}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="flex flex-col gap-4 rounded-md border bg-card p-6" aria-live="polite">
          <div className="flex items-center gap-2 border-b pb-3">
            <Rocket className="size-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">{definition.label}</h2>
          </div>
          <p className="text-muted-foreground">{definition.hint}</p>
          {count && <p className="text-sm">{count}</p>}
          <p className="text-sm">{current.done ? t("setup.doneHint") : t("setup.todoHint")}</p>
          <div>
            <Button asChild>
              <Link href={definition.href}>{current.done ? t("setup.review") : t("setup.configure")}</Link>
            </Button>
          </div>
          <div className="mt-auto flex justify-between border-t pt-4">
            <Button variant="outline" disabled={selected === 0} onClick={() => setSelected((i) => i - 1)}>
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              {t("setup.previous")}
            </Button>
            <Button
              variant="outline"
              disabled={selected === steps.length - 1}
              onClick={() => setSelected((i) => i + 1)}
            >
              {t("setup.next")}
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
