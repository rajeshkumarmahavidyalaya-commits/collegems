"use client";

import { useState, useTransition } from "react";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { setExamPublic } from "../actions";

/**
 * Whether this exam is on the college's public timetable and admit card
 * lookup (0361). The pages themselves are switched on in settings; this says
 * which exams they show, because a draft exam's dates are a draft.
 */
export function PublicTimetableToggle({ examId, initial }: { examId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  function change(next: boolean) {
    setOn(next);
    start(async () => {
      const r = await setExamPublic(examId, next);
      if (!r.ok) {
        setOn(!next);
        toast.error(r.error);
        return;
      }
      toast.success(next ? "Shown on the public exam timetable and admit cards" : "Taken off the public pages");
    });
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
      <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
      <Label htmlFor="exam-public" className="text-sm font-normal">
        Public timetable and admit cards
      </Label>
      <Switch id="exam-public" checked={on} onCheckedChange={change} disabled={pending} />
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
    </div>
  );
}
