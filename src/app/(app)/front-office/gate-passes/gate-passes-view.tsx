"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, Loader2, LogOut, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import { ExportRowsButton } from "@/components/export-rows-button";
import { useI18n } from "@/components/providers/i18n-provider";
import { checkOutVisitor } from "../actions";
import { issueGatePass, searchStudentsForGatePass, type GatePassRow } from "../gate-pass-actions";

const EMPTY = { visitorName: "", phone: "", relation: "", authorizedBy: "", reason: "" };

/**
 * The reference's Gate Passes: the list (Visitor Name, Mobile, Relation,
 * Student, Class, Section, Date, In Time, Out Time, Authorized By, Action) and
 * "Add Gate Pass". In and out are the log's own times -- issued now, signed
 * out from the row -- never typed.
 */
export function GatePassesView({ rows, canManage }: { rows: GatePassRow[]; canManage: boolean }) {
  const { formatDate, formatTime } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await issueGatePass({ ...form, studentId: student?.id ?? "" });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.error);
        return;
      }
      toast.success(`Gate pass ${r.data.passNumber} issued to ${form.visitorName.trim()} for ${student?.name}.`);
      setOpen(false);
      setForm(EMPTY);
      setStudent(null);
      setErrors({});
      router.refresh();
    });
  }

  function signOut(row: GatePassRow) {
    start(async () => {
      const r = await checkOutVisitor(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${row.visitorName} signed out.`);
      router.refresh();
    });
  }

  const field = (k: keyof typeof EMPTY | "studentId") =>
    errors[k]?.[0] ? (
      <p id={`gp-${k}-error`} className="text-sm text-destructive">
        {errors[k][0]}
      </p>
    ) : null;

  const exportRows = [
    ["Visitor Name", "Mobile", "Relation", "Student", "Class", "Section", "Date", "In Time", "Out Time", "Authorized By"],
    ...rows.map((r) => [
      r.visitorName,
      r.phone ?? "",
      r.relation ?? "",
      r.studentName ?? "",
      r.className ?? "",
      r.sectionName ?? "",
      formatDate(r.inAt),
      formatTime(r.inAt),
      r.outAt ? formatTime(r.outAt) : "",
      r.authorizedBy ?? "",
    ]),
  ];

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="gate-passes-list">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <h2 id="gate-passes-list" className="text-lg font-semibold">
          Gate Passes
        </h2>
        <div className="ms-auto flex flex-wrap gap-2">
          <ExportRowsButton rows={exportRows} fileName="gate-passes.csv" />
          {canManage && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add Gate Pass
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <DoorOpen className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No gate passes this year.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            A gate pass is somebody who comes for a student: a parent collecting a child, a driver, a relative. It is
            written in the visitor log with the student on it.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visitor Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Relation</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>In Time</TableHead>
                <TableHead>Out Time</TableHead>
                <TableHead>Authorized By</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="font-medium">{r.visitorName}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{r.passNumber}</span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{r.phone ?? "—"}</TableCell>
                  <TableCell>{r.relation ?? "—"}</TableCell>
                  <TableCell>
                    {r.studentName ?? "—"}
                    {r.admissionNumber && (
                      <span className="block font-mono text-xs text-muted-foreground">{r.admissionNumber}</span>
                    )}
                  </TableCell>
                  <TableCell>{r.className ?? "—"}</TableCell>
                  <TableCell>{r.sectionName ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.inAt)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatTime(r.inAt)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {r.outAt ? formatTime(r.outAt) : <span className="text-muted-foreground">Still here</span>}
                  </TableCell>
                  <TableCell>{r.authorizedBy ?? "—"}</TableCell>
                  <TableCell>
                    {canManage && !r.outAt ? (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => signOut(r)}>
                        <LogOut className="size-4" aria-hidden="true" />
                        Sign out
                      </Button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Gate Pass</DialogTitle>
            <DialogDescription>
              The pass is written in the visitor log now, with the student on it. Sign the visitor out from the list when
              they leave.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gp-student">Student</Label>
              <StudentPicker id="gp-student" selected={student} onSelect={setStudent} search={searchStudentsForGatePass} />
              {field("studentId")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-visitorName">Visitor Name</Label>
                <Input id="gp-visitorName" value={form.visitorName} onChange={set("visitorName")} maxLength={120} aria-invalid={Boolean(errors.visitorName)} />
                {field("visitorName")}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-phone">Mobile Number</Label>
                <Input id="gp-phone" type="tel" value={form.phone} onChange={set("phone")} maxLength={20} aria-invalid={Boolean(errors.phone)} />
                {field("phone")}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-relation">Relation to Student</Label>
                <Input id="gp-relation" value={form.relation} onChange={set("relation")} maxLength={60} placeholder="Mother, driver, uncle" aria-invalid={Boolean(errors.relation)} />
                {field("relation")}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gp-authorizedBy">Authorized By</Label>
                <Input id="gp-authorizedBy" value={form.authorizedBy} onChange={set("authorizedBy")} maxLength={120} aria-invalid={Boolean(errors.authorizedBy)} />
                {field("authorizedBy")}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gp-reason">Reason to Meet (Optional)</Label>
              <Textarea id="gp-reason" rows={2} value={form.reason} onChange={set("reason")} maxLength={300} />
              {field("reason")}
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Add Gate Pass
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
