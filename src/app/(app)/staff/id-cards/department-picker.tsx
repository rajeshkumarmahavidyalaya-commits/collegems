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

/** Sentinel for "no filter". A `<SelectItem>` may not have an empty value. */
const ALL = "__all__";

/**
 * Which department this sheet is for, kept in the URL so the sheet is a link
 * somebody can send and reload — the same reasoning as the class picker.
 *
 * The list is built from the cards that came back rather than from a fixed
 * enumeration, because `staff.department` is free text: a school that types
 * "Science" and "Sciences" gets two entries, which is the honest rendering of
 * what is in the column and a better prompt to tidy it than a silent merge.
 */
export function DepartmentPicker({
  departments,
  value,
  label,
  allLabel,
}: {
  departments: string[];
  value: string | null;
  label: string;
  allLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pick(next: string) {
    const search = new URLSearchParams(params.toString());
    if (next === ALL) search.delete("department");
    else search.set("department", next);
    const query = search.toString();
    router.push(query ? `?${query}` : "?");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="staff-card-department">{label}</Label>
      <Select value={value ?? ALL} onValueChange={pick}>
        <SelectTrigger id="staff-card-department" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {departments.map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
