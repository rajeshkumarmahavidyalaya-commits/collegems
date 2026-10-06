"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import { ExportRowsButton } from "@/components/export-rows-button";
import { useI18n } from "@/components/providers/i18n-provider";
import { joinActivity, searchStudentsForActivity, withdrawFromActivity, type ActivityParticipant } from "../actions";

/**
 * The students on one activity. Adding one raises the fee on their account;
 * taking one off cancels it, or refuses with what to reverse first if money
 * was taken (`activity_withdraw`). Withdrawn students stay listed.
 */
export function ActivityParticipants({
  activityId,
  name,
  fee,
  isActive,
  rows,
  canManage,
}: {
  activityId: string;
  name: string;
  fee: number;
  isActive: boolean;
  rows: ActivityParticipant[];
  canManage: boolean;
}) {
  const { formatDate, formatCurrency } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const active = rows.filter((r) => r.status === "active").length;

  function add() {
    if (!student) return;
    start(async () => {
      const r = await joinActivity(activityId, student.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        r.data.already
          ? `${student.name} is already on "${name}".`
          : r.data.invoiceNumber
            ? `${student.name} is on "${name}". Invoice ${r.data.invoiceNumber} raised for ${formatCurrency(fee)}.`
            : `${student.name} is on "${name}".`,
      );
      setStudent(null);
      router.refresh();
    });
  }

  function withdraw(row: ActivityParticipant) {
    const bill = row.invoiceNumber && row.invoiceStatus === "issued" ? ` Invoice ${row.invoiceNumber} will be cancelled.` : "";
    if (!window.confirm(`Take ${row.name} off "${name}"?${bill}`)) return;
    start(async () => {
      const r = await withdrawFromActivity(activityId, row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${row.name} is off "${name}".${r.data.invoiceCancelled ? ` Invoice ${row.invoiceNumber} cancelled.` : ""}`);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="activity-students">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <h2 id="activity-students" className="text-lg font-semibold">
          Students ({active})
        </h2>
        <div className="ms-auto">
          <ExportRowsButton
            rows={[
              ["#", "Student", "Admission Number", "Joined", "Status", "Invoice"],
              ...rows.map((r, i) => [String(i + 1), r.name, r.admissionNumber, formatDate(r.joinedOn), r.status, r.invoiceNumber ?? ""]),
            ]}
            fileName="activity-students.csv"
          />
        </div>
      </div>

      {canManage &&
        (isActive ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-72 flex-col gap-1.5">
              <Label htmlFor="activity-student">Add a student</Label>
              <StudentPicker id="activity-student" selected={student} onSelect={setStudent} search={searchStudentsForActivity} />
            </div>
            <Button onClick={add} disabled={!student || pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
              Add
            </Button>
            {fee > 0 && <p className="w-full text-xs text-muted-foreground">Adding a student raises {formatCurrency(fee)} on their fee account.</p>}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This activity is inactive, so it takes no new students.</p>
        ))}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No students on this activity yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Admission Number</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice</TableHead>
                {canManage && <TableHead className="w-24">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.id} className={r.status === "withdrawn" ? "opacity-70" : undefined}>
                  <TableCell className="tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.admissionNumber}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.joinedOn)}</TableCell>
                  <TableCell>
                    {r.status === "active" ? (
                      <Badge variant="success">On it</Badge>
                    ) : (
                      <Badge variant="outline">Withdrawn {r.withdrawnOn ? formatDate(r.withdrawnOn) : ""}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.invoiceNumber ? (
                      <span>
                        {r.invoiceNumber}
                        {r.invoiceStatus === "cancelled" && <span className="ms-1 text-xs text-muted-foreground">(cancelled)</span>}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {r.status === "active" && (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => withdraw(r)}>
                          <UserMinus className="size-4" aria-hidden="true" />
                          Take off
                        </Button>
                      )}
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
