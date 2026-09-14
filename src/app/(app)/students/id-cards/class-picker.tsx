"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The class this sheet is for, kept in the URL.
 *
 * A search param rather than component state so the sheet is a link somebody
 * can send, bookmark and reload — which for a page whose whole purpose is to be
 * printed is the difference between "print class 6A's cards" and "open the
 * page, then find 6A again".
 *
 * The options come from `listSections()`, which is scoped to the current
 * session, so this cannot offer last year's "Grade 1 · A" beside this year's
 * under the same label.
 */
export function ClassPicker({
  sections,
  value,
  label,
}: {
  sections: { id: string; label: string }[];
  value: string | null;
  label: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pick(next: string) {
    const search = new URLSearchParams(params.toString());
    search.set("section", next);
    router.push(`?${search.toString()}`);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="id-card-class">{label}</Label>
      <Select value={value ?? undefined} onValueChange={pick}>
        <SelectTrigger id="id-card-class" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sections.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
