"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/components/providers/i18n-provider";
import { choiceRule, progressSentence, type GroupOverview } from "@/lib/validations/electives";
import { deleteElectiveGroup, setElectiveWindow, type ClassLevelOption, type SubjectOption } from "./actions";

// Fetched on the click that opens it (docs/performance.md).
const CreateGroupDialog = dynamic(() => import("./create-group-dialog").then((m) => m.CreateGroupDialog));

function GroupCard({ group }: { group: GroupOverview }) {
  const { formatDate } = useI18n();
  const [pending, startTransition] = useTransition();
  const [closesOn, setClosesOn] = useState(group.closesOn ?? "");

  function save(isOpen: boolean, date: string) {
    startTransition(async () => {
      const r = await setElectiveWindow(group.id, isOpen, date || null);
      if (!r.ok) toast.error(r.error);
      else toast.success(isOpen ? `${group.name} is open for ${group.classLevel}.` : `${group.name} is closed.`);
    });
  }

  function remove() {
    const lost = group.chosen
      ? ` ${group.chosen} ${group.chosen === 1 ? "student has" : "students have"} chosen already, and those choices will be removed too.`
      : "";
    if (!window.confirm(`Remove "${group.name}" for ${group.classLevel}?${lost}`)) return;
    startTransition(async () => {
      const r = await deleteElectiveGroup(group.id);
      if (!r.ok) toast.error(r.error);
      else toast.success(`Removed ${group.name}.`);
    });
  }

  const top = Math.max(1, ...group.options.map((o) => o.count));

  return (
    <Card>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{group.name}</CardTitle>
            <CardDescription>
              {group.classLevel} · {choiceRule(group.min, group.max)}
            </CardDescription>
          </div>
          <Badge variant={group.isOpen ? "default" : "outline"}>{group.isOpen ? "Open" : "Closed"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{progressSentence(group.chosen, group.enrolled)}</p>
        <ul className="flex flex-col gap-2">
          {group.options.map((o) => (
            <li key={o.subjectId} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{o.name}</span>
                <span className="font-mono text-muted-foreground">{o.count}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted" aria-hidden="true">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(o.count / top) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Switch
              id={`open-${group.id}`}
              checked={group.isOpen}
              disabled={pending}
              onCheckedChange={(v) => save(v, closesOn)}
            />
            <Label htmlFor={`open-${group.id}`}>Open for choosing</Label>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`closes-${group.id}`} className="text-xs text-muted-foreground">
              Closes on {group.closesOn ? `(now ${formatDate(group.closesOn)})` : "(optional)"}
            </Label>
            <div className="flex gap-2">
              <Input
                id={`closes-${group.id}`}
                type="date"
                value={closesOn}
                onChange={(e) => setClosesOn(e.target.value)}
                className="w-40"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={pending || closesOn === (group.closesOn ?? "")}
                onClick={() => save(group.isOpen, closesOn)}
              >
                Save date
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="ms-auto text-destructive" disabled={pending} onClick={remove}>
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ElectivesManager({
  groups,
  classLevels,
  subjects,
}: {
  groups: GroupOverview[];
  classLevels: ClassLevelOption[];
  subjects: SubjectOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New elective choice
        </Button>
      </div>
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ListChecks className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No elective choices this year</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Create one for a class — for example &ldquo;Language electives, choose 1 of Sanskrit, Urdu,
              French&rdquo; — and its students will see it on their own login.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <GroupCard key={`${g.id}-${g.isOpen}-${g.closesOn}`} group={g} />
          ))}
        </div>
      )}
      {open && (
        <CreateGroupDialog open={open} onOpenChange={setOpen} classLevels={classLevels} subjects={subjects} />
      )}
    </div>
  );
}
