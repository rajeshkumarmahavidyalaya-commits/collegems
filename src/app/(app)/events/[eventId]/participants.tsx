"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import { ExportRowsButton } from "@/components/export-rows-button";
import { useI18n } from "@/components/providers/i18n-provider";
import { addParticipant, removeParticipant, searchStudentsForEvent, type ParticipantRow } from "../actions";

/**
 * Who is taking part in one event. Staff read every row; a family reads its
 * own children's (the policies). The administrator adds and removes; the
 * table's policy is the gate and these buttons are drawn for them alone.
 */
export function Participants({
  eventId,
  title,
  rows,
  canManage,
}: {
  eventId: string;
  title: string;
  rows: ParticipantRow[];
  canManage: boolean;
}) {
  const { formatDate } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [student, setStudent] = useState<PickedStudent | null>(null);

  function add() {
    if (!student) return;
    start(async () => {
      const r = await addParticipant(eventId, student.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${student.name} is taking part in "${title}".`);
      setStudent(null);
      router.refresh();
    });
  }

  function remove(row: ParticipantRow) {
    if (!window.confirm(`Take ${row.name} off "${title}"?`)) return;
    start(async () => {
      const r = await removeParticipant(eventId, row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${row.name} is off "${title}".`);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="participants">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <h2 id="participants" className="text-lg font-semibold">
          Participants ({rows.length})
        </h2>
        <div className="ms-auto">
          <ExportRowsButton
            rows={[["#", "Student", "Admission Number", "Added"], ...rows.map((r, i) => [String(i + 1), r.name, r.admissionNumber, formatDate(r.addedAt)])]}
            fileName="event-participants.csv"
          />
        </div>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-72 flex-col gap-1.5">
            <Label htmlFor="event-student">Add a student</Label>
            <StudentPicker id="event-student" selected={student} onSelect={setStudent} search={searchStudentsForEvent} />
          </div>
          <Button onClick={add} disabled={!student || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
            Add
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nobody is taking part yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Admission Number</TableHead>
                <TableHead>Added</TableHead>
                {canManage && <TableHead className="w-20">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.admissionNumber}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.addedAt)}</TableCell>
                  {canManage && (
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Take ${r.name} off`}
                        disabled={pending}
                        onClick={() => remove(r)}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
