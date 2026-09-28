"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, BookOpen, Bus, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
type PickOption = { id: string; label: string; detail?: string; full?: boolean };

const ICONS = { bus: Bus, bed: BedDouble } as const;

/**
 * Give somebody a bus seat or a hostel bed from their own record (0296).
 *
 * The choreography is shared and the authority is not (rule 8): the options
 * and the write arrive as server actions, bound on the page to the person, so
 * this component decides nothing about who may and names nobody. A refusal is
 * the module's own sentence, shown as written.
 */
export function ArrangeButton({
  kind,
  label,
  title,
  description,
  pickLabel,
  load,
  submit,
  withDirection = false,
}: {
  kind: keyof typeof ICONS;
  label: string;
  title: string;
  description: string;
  pickLabel: string;
  load: () => Promise<PickOption[]>;
  submit: (optionId: string, runs: string, startsOn: string) => Promise<Result>;
  withDirection?: boolean;
}) {
  const router = useRouter();
  const Icon = ICONS[kind];
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickOption[] | null>(null);
  const [optionId, setOptionId] = useState("");
  const [runs, setRuns] = useState("both");
  const [startsOn, setStartsOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setOpen(true);
    setError(null);
    // Read on the click that opens it: the fares and free seats are today's,
    // not whatever they were when the record page rendered.
    if (options === null) void load().then(setOptions);
  }

  const chosen = options?.find((o) => o.id === optionId) ?? null;

  function save() {
    setError(null);
    if (!optionId) {
      setError(`Choose a ${pickLabel.toLowerCase()}.`);
      return;
    }
    startTransition(async () => {
      const result = await submit(optionId, runs, startsOn);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${chosen?.label ?? "Done"}.`);
      setOpen(false);
      setOptionId("");
      setStartsOn("");
      setOptions(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog} className="w-fit cursor-pointer">
        <Plus className="size-3.5" aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`arrange-${kind}`}>{pickLabel}</Label>
              {options === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Loading…
                </p>
              ) : options.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing to choose from yet. Set it up on the module&apos;s own page first.
                </p>
              ) : (
                <Select value={optionId} onValueChange={setOptionId}>
                  <SelectTrigger id={`arrange-${kind}`} className="cursor-pointer">
                    <SelectValue placeholder={`Choose a ${pickLabel.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id} disabled={o.full} className="cursor-pointer">
                        {o.label}
                        {o.full ? " (full)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {chosen?.detail && <p className="text-xs text-muted-foreground">{chosen.detail}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {withDirection && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`arrange-${kind}-runs`}>Runs</Label>
                  <Select value={runs} onValueChange={setRuns}>
                    <SelectTrigger id={`arrange-${kind}-runs`} className="cursor-pointer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Both ways</SelectItem>
                      <SelectItem value="pickup">Morning pickup only</SelectItem>
                      <SelectItem value="drop">Afternoon drop only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`arrange-${kind}-from`}>Starting</Label>
                <Input
                  id={`arrange-${kind}-from`}
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Blank means today.</p>
              </div>
            </div>
            <p aria-live="assertive" className="min-h-5">
              {error && (
                <span role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </span>
              )}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={pending || !optionId} className="cursor-pointer">
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A library card with the next number, in one click: there is nothing to decide. */
export function LibraryCardButton({ give }: { give: () => Promise<Result<{ number: string }>> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      className="w-fit cursor-pointer"
      onClick={() =>
        startTransition(async () => {
          const result = await give();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`Library card ${result.data.number} issued.`);
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <BookOpen className="size-3.5" aria-hidden="true" />
      )}
      Give a library card
    </Button>
  );
}
