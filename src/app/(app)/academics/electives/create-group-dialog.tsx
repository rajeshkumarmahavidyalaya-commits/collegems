"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { choiceRule } from "@/lib/validations/electives";
import { createElectiveGroup, type ClassLevelOption, type SubjectOption } from "./actions";

export function CreateGroupDialog({
  open,
  onOpenChange,
  classLevels,
  subjects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classLevels: ClassLevelOption[];
  subjects: SubjectOption[];
}) {
  const [classLevelId, setClassLevelId] = useState("");
  const [name, setName] = useState("");
  const [min, setMin] = useState("1");
  const [max, setMax] = useState("1");
  const [closesOn, setClosesOn] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nMin = Number(min);
  const nMax = Number(max);
  const className = classLevels.find((c) => c.id === classLevelId)?.name;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createElectiveGroup({
        classLevelId,
        name,
        min: nMin,
        max: nMax,
        subjectIds: picked,
        closesOn: closesOn || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(`Created "${name.trim()}" for ${className}. It is closed until you open it.`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New elective choice</DialogTitle>
            <DialogDescription>
              The subjects you tick are the only ones this class&rsquo;s students can choose from.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eg-class">Class</Label>
            <Select value={classLevelId} onValueChange={setClassLevelId}>
              <SelectTrigger id="eg-class">
                <SelectValue placeholder="Pick a class" />
              </SelectTrigger>
              <SelectContent>
                {classLevels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eg-name">Name</Label>
            <Input
              id="eg-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Language electives"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eg-min">At least</Label>
              <Input id="eg-min" type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eg-max">At most</Label>
              <Input id="eg-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Subjects offered ({picked.length} ticked)</legend>
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {subjects.map((s) => {
                const id = `eg-sub-${s.id}`;
                return (
                  <label key={s.id} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-accent">
                    <Checkbox
                      id={id}
                      checked={picked.includes(s.id)}
                      onCheckedChange={(v) =>
                        setPicked((p) => (v === true ? [...p, s.id] : p.filter((x) => x !== s.id)))
                      }
                    />
                    {s.name}
                    <span className="text-muted-foreground">{s.code}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eg-closes">Choices close on (optional)</Label>
            <Input id="eg-closes" type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
          </div>

          {className && name.trim() && picked.length >= 2 && nMax >= 1 && nMin <= nMax && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Students of <strong>{className}</strong> will see &ldquo;{name.trim()}&rdquo; with {picked.length}{" "}
              subjects on offer. {choiceRule(nMin, nMax)}.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !classLevelId}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
