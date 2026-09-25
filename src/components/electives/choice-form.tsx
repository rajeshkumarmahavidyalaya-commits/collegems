"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { selectionProblem, type ElectiveGroup } from "@/lib/validations/electives";

/**
 * One elective group as ticks. Shared by a student choosing for themselves and
 * the office choosing on a child's behalf, so it takes the save as a prop: the
 * choreography is shared, the authorization stays with the caller's action
 * (rule 8's split, as the student picker does).
 */
type Save = (groupId: string, subjectIds: string[]) => Promise<{ ok: true } | { ok: false; error: string }>;

export function ChoiceForm({ group, save: saveChoice }: { group: ElectiveGroup; save: Save }) {
  const initial = group.options.filter((o) => o.chosen).map((o) => o.subjectId);
  const [picked, setPicked] = useState<string[]>(initial);
  const [pending, startTransition] = useTransition();

  const problem = selectionProblem(picked.length, group.min, group.max);
  const changed = picked.length !== initial.length || picked.some((id) => !initial.includes(id));
  const full = picked.length >= group.max;

  function toggle(id: string, on: boolean) {
    setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  }

  function save() {
    startTransition(async () => {
      const r = await saveChoice(group.id, picked);
      if (r.ok) toast.success(`Saved your choice for ${group.name}.`);
      else toast.error(r.error);
    });
  }

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="sr-only">{group.name}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {group.options.map((o) => {
          const on = picked.includes(o.subjectId);
          const id = `opt-${group.id}-${o.subjectId}`;
          return (
            <label
              key={o.subjectId}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[button:disabled]:cursor-not-allowed has-[button:disabled]:opacity-60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <Checkbox
                id={id}
                checked={on}
                // At the limit the rest are disabled rather than refused on save,
                // so the rule is visible before anybody breaks it.
                disabled={!on && full}
                onCheckedChange={(v) => toggle(o.subjectId, v === true)}
              />
              <span className="text-sm">
                <span className="font-medium">{o.name}</span>
                {o.code && <span className="ms-2 text-muted-foreground">{o.code}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending || !!problem || !changed}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Save choice
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {problem ??
            (changed
              ? `${picked.length} chosen. Save to keep it.`
              : initial.length
                ? "Saved."
                : "Nothing chosen yet.")}
        </p>
      </div>
    </fieldset>
  );
}
