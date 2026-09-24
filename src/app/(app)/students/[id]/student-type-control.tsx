"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignStudentType } from "../../fees/setup/student-type-actions";

const REGULAR = "regular";

/**
 * What kind of student this child is this year (0281): regular, carry-over,
 * or whatever else the college charges differently. Drawn only for the roles
 * the policy lets write it; saving takes effect from the next invoice.
 */
export function StudentTypeControl({
  studentId,
  studentName,
  current,
  types,
  sessionName,
}: {
  studentId: string;
  studentName: string;
  current: string | null;
  types: { id: string; name: string; isActive: boolean }[];
  sessionName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function change(value: string) {
    const typeId = value === REGULAR ? null : value;
    if (typeId === current) return;
    startTransition(async () => {
      const r = await assignStudentType(studentId, typeId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        typeId
          ? `${studentName} is a ${r.data.type} student in ${sessionName}. Invoices raised from now on use those fees.`
          : `${studentName} pays regular fees in ${sessionName} again.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={current ?? REGULAR} onValueChange={change} disabled={pending}>
        <SelectTrigger className="w-full sm:w-56" aria-label={`What kind of student ${studentName} is in ${sessionName}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={REGULAR}>Regular</SelectItem>
          {types
            .filter((t) => t.isActive || t.id === current)
            .map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
    </div>
  );
}
