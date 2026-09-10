"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setPlan } from "./actions";

const PLANS = ["trial", "standard", "premium"];
const STATUSES = ["trialing", "active", "past_due", "cancelled", "expired"];

/**
 * Moving one college between plans.
 *
 * The screen the college itself sees says changing plan is not self-serve and
 * to get in touch. This is the other half of that sentence — without it,
 * `/settings/plan` makes a promise nobody can keep, which is the failure this
 * codebase keeps naming.
 *
 * The confirm step is deliberate: this changes what a paying customer is
 * charged and what their ceiling is, and it is two dropdowns away from doing it
 * to the wrong college in a list of many.
 */
export function PlanControl({
  tenantId,
  name,
  planCode,
  planStatus,
}: {
  tenantId: string;
  name: string;
  planCode: string | null;
  planStatus: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [plan, setPlanCode] = useState(planCode ?? "trial");
  const [status, setStatus] = useState(planStatus ?? "active");
  const [confirming, setConfirming] = useState(false);

  const changed = plan !== planCode || status !== planStatus;

  function apply() {
    startTransition(async () => {
      const result = await setPlan(tenantId, plan, status);
      setConfirming(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name}: ${result.from} → ${result.to}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`plan-${tenantId}`} className="text-xs">
          Plan
        </Label>
        <select
          id={`plan-${tenantId}`}
          value={plan}
          onChange={(e) => setPlanCode(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`status-${tenantId}`} className="text-xs">
          Status
        </Label>
        <select
          id={`status-${tenantId}`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {!confirming ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!changed || pending}
          onClick={() => setConfirming(true)}
        >
          Change plan
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm" aria-live="polite">
            Move <span className="font-medium">{name}</span> to{" "}
            <span className="font-mono">
              {plan}/{status}
            </span>
            ?
          </p>
          <Button type="button" size="sm" onClick={apply} disabled={pending}>
            {pending && <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />}
            Confirm
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
