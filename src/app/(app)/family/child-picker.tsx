"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * A parent's "which child" picker, as the reference's Parent Dashboard has it.
 * It changes only the address; every read behind it is row-owned or checks
 * `family_owns_student`, so picking an id that is not yours shows nothing.
 */
export function ChildPicker({
  options,
  selected,
}: {
  options: { studentId: string; name: string; sectionLabel: string | null }[];
  selected: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="family-child" className="text-sm">
        Child
      </Label>
      <Select
        value={selected}
        onValueChange={(value) => {
          const next = new URLSearchParams(params.toString());
          next.set("child", value);
          // A month or an exam chosen for one child means nothing for another.
          next.delete("month");
          next.delete("exam");
          router.push(`${pathname}?${next.toString()}`);
        }}
      >
        <SelectTrigger id="family-child" className="w-64 max-w-full bg-background text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.studentId} value={c.studentId}>
              {c.name}
              {c.sectionLabel ? ` · ${c.sectionLabel}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
