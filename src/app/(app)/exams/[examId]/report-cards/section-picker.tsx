"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The class picker. It navigates rather than fetching, so the chosen class is
 * in the URL — which is what makes a printed run reproducible and a link to
 * "Grade 6 B's cards" something a head teacher can send to somebody.
 */
export function SectionPicker({
  examId,
  sections,
  value,
}: {
  examId: string;
  sections: { id: string; label: string }[];
  value: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="report-card-section">Class</Label>
      <Select
        value={value ?? undefined}
        onValueChange={(next) => {
          startTransition(() => {
            router.push(`/exams/${examId}/report-cards?section=${next}`);
          });
        }}
      >
        <SelectTrigger id="report-card-section" className="w-[16rem] cursor-pointer">
          <SelectValue placeholder="Choose a class" />
        </SelectTrigger>
        <SelectContent>
          {sections.map((s) => (
            <SelectItem key={s.id} value={s.id} className="cursor-pointer">
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {pending ? "Loading cards…" : " "}
      </p>
    </div>
  );
}
