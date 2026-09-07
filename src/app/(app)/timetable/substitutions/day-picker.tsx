"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayIso } from "@/lib/validations/substitutions";

/**
 * The day the whole screen is about.
 *
 * It travels in the URL rather than in component state, so a link to a
 * particular morning is a link somebody can send — which is the normal way this
 * screen gets shared ("look at Tuesday, we are three short").
 */
export function DayPicker({ date }: { date?: string }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="cover-date">Day</Label>
      <Input
        id="cover-date"
        type="date"
        className="max-w-56"
        defaultValue={date ?? todayIso()}
        onChange={(event) => {
          const next = event.target.value;
          router.push(next ? `/timetable/substitutions?date=${next}` : "/timetable/substitutions");
        }}
      />
    </div>
  );
}
