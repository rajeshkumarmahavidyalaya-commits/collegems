"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, RefreshCw, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StudentPicker, type PickedStudent } from "@/components/people/student-picker";
import { useI18n } from "@/components/providers/i18n-provider";
import { TICKET_PRIORITIES, TICKET_STATUSES, ticketPriorityLabel, ticketStatusLabel } from "@/lib/validations/tickets-display";
import {
  removeTicket,
  saveTicket,
  searchStudentsForTicket,
  setTicketStatus,
  type TicketOptions,
  type TicketRow,
} from "./actions";

const NONE = "__none";
const ROLES = [
  { value: "teacher", label: "Teacher" },
  { value: "accountant", label: "Accountant" },
  { value: "librarian", label: "Librarian" },
  { value: "admin", label: "Administrator" },
];

const priorityVariant = (p: string) => (p === "urgent" || p === "high" ? "destructive" : p === "medium" ? "warning" : "secondary");
const statusVariant = (s: string) => (s === "resolved" || s === "closed" ? "success" : s === "in_progress" ? "warning" : "outline");

/**
 * The reference's Tickets Management: #, Title, Priority, Status, Subject,
 * Student Name, Class, Role, Assigned To, Due Date, Created On, Action. The
 * administrator creates and edits; the person a ticket is assigned to (and
 * the administrator) changes its status. The policies decide both; these
 * buttons are drawn for the same people.
 */
export function TicketsView({ rows, options, isAdmin }: { rows: TicketRow[]; options: TicketOptions; isAdmin: boolean }) {
  const { formatDate, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<TicketRow | "new" | null>(null);
  const [statusOf, setStatusOf] = useState<TicketRow | null>(null);
  const [filter, setFilter] = useState("all");
  const today = new Date().toISOString().slice(0, 10);

  const shown = useMemo(() => rows.filter((r) => filter === "all" || r.status === filter), [rows, filter]);

  function remove(row: TicketRow) {
    if (!window.confirm(`Remove the ticket "${row.title}"?`)) return;
    start(async () => {
      const r = await removeTicket(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Ticket "${row.title}" removed.`);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="tickets-list">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <h2 id="tickets-list" className="text-lg font-semibold">
          Tickets ({rows.length})
        </h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Label htmlFor="ticket-filter" className="sr-only">
            Show
          </Label>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger id="ticket-filter" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TICKET_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ticketStatusLabel(s, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden="true" />
              Create New Ticket
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Ticket className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">No tickets this year.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {isAdmin
              ? "A ticket is something to be done about a student, with a priority, a person and a due date. Families can raise one too."
              : "Tickets assigned to you, or that you raised, appear here."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Student Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Created On</TableHead>
                <TableHead className="w-32">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r, i) => {
                const overdue = r.dueOn && r.dueOn < today && r.status !== "resolved" && r.status !== "closed";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableCell className="min-w-48">
                      <span className="font-medium">{r.title}</span>
                      {r.raisedByFamily && (
                        <Badge variant="outline" className="ms-2">
                          From family
                        </Badge>
                      )}
                      {r.description && <span className="block max-w-72 truncate text-xs text-muted-foreground">{r.description}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant(r.priority)}>{ticketPriorityLabel(r.priority, t)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{ticketStatusLabel(r.status, t)}</Badge>
                    </TableCell>
                    <TableCell>{r.subjectName ?? "—"}</TableCell>
                    <TableCell>{r.studentName}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.classLabel ?? "—"}</TableCell>
                    <TableCell>{ROLES.find((x) => x.value === r.assigneeRole)?.label ?? "—"}</TableCell>
                    <TableCell>{r.assignedToName ?? "Unassigned"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.dueOn ? formatDate(r.dueOn) : "—"}
                      {overdue && <span className="block text-xs text-destructive">Overdue</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(r.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {(isAdmin || r.isMine) && (
                          <Button size="icon" variant="ghost" aria-label={`Change the status of ${r.title}`} onClick={() => setStatusOf(r)}>
                            <RefreshCw className="size-4" aria-hidden="true" />
                          </Button>
                        )}
                        {isAdmin && (
                          <>
                            <Button size="icon" variant="ghost" aria-label={`Edit ${r.title}`} onClick={() => setEditing(r)}>
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label={`Remove ${r.title}`} disabled={pending} onClick={() => remove(r)}>
                              <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {shown.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="py-8 text-center text-sm text-muted-foreground">
                    No ticket has that status.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {editing && (
        <TicketDialog
          ticket={editing === "new" ? null : editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {statusOf && (
        <StatusDialog
          ticket={statusOf}
          onClose={() => setStatusOf(null)}
          onSaved={() => {
            setStatusOf(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function TicketDialog({
  ticket,
  options,
  onClose,
  onSaved,
}: {
  ticket: TicketRow | null;
  options: TicketOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [form, setForm] = useState({
    title: ticket?.title ?? "",
    description: ticket?.description ?? "",
    priority: ticket?.priority ?? "medium",
    subjectId: ticket?.subjectId ?? "",
    assigneeRole: ticket?.assigneeRole ?? "",
    assignedToStaffId: ticket?.assignedToStaffId ?? "",
    dueOn: ticket?.dueOn ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveTicket({ ...form, studentId: ticket?.studentId ?? student?.id ?? "" }, ticket?.id);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.error);
        return;
      }
      toast.success(ticket ? `Ticket "${form.title.trim()}" saved.` : `Ticket "${form.title.trim()}" created.`);
      onSaved();
    });
  }

  const pick = (key: "subjectId" | "assigneeRole" | "assignedToStaffId") => (v: string) =>
    setForm((f) => ({ ...f, [key]: v === NONE ? "" : v }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{ticket ? "Edit Ticket" : "Create New Ticket"}</DialogTitle>
          <DialogDescription>Who it is about, who will do it, and by when.</DialogDescription>
        </DialogHeader>
        <form id="ticket-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ticket-title">Ticket Title *</Label>
            <Input
              id="ticket-title"
              value={form.title}
              maxLength={150}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              aria-invalid={Boolean(errors.title)}
            />
            {errors.title && <p className="text-sm text-destructive">{errors.title[0]}</p>}
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ticket-student">Student *</Label>
            {ticket ? (
              <p className="text-sm">
                {ticket.studentName}
                {ticket.classLabel ? ` · ${ticket.classLabel}` : ""}
              </p>
            ) : (
              <StudentPicker id="ticket-student" selected={student} onSelect={setStudent} search={searchStudentsForTicket} />
            )}
            {errors.studentId && <p className="text-sm text-destructive">{errors.studentId[0]}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-due">Due Date *</Label>
            <Input
              id="ticket-due"
              type="date"
              value={form.dueOn}
              onChange={(e) => setForm((f) => ({ ...f, dueOn: e.target.value }))}
              aria-invalid={Boolean(errors.dueOn)}
            />
            {errors.dueOn && <p className="text-sm text-destructive">{errors.dueOn[0]}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-priority">Priority</Label>
            <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
              <SelectTrigger id="ticket-priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {ticketPriorityLabel(p, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Select value={form.subjectId || NONE} onValueChange={pick("subjectId")}>
              <SelectTrigger id="ticket-subject" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {options.subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-role">Role</Label>
            <Select value={form.assigneeRole || NONE} onValueChange={pick("assigneeRole")}>
              <SelectTrigger id="ticket-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ticket-assignee">Assign To</Label>
            <Select value={form.assignedToStaffId || NONE} onValueChange={pick("assignedToStaffId")}>
              <SelectTrigger id="ticket-assignee" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {options.staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea
              id="ticket-description"
              rows={3}
              maxLength={4000}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ticket-form" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {ticket ? "Save" : "Create Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ ticket, onClose, onSaved }: { ticket: TicketRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(ticket.status);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const r = await setTicketStatus(ticket.id, status, note);
      if (!r.ok) return setError(r.error);
      toast.success(`"${ticket.title}": ${ticketStatusLabel(status, t)}.`);
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>{ticket.title}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="ticket-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ticketStatusLabel(s, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-note">Note (optional)</Label>
            <Textarea id="ticket-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            {ticket.resolutionNote && <p className="text-xs text-muted-foreground">Last note: {ticket.resolutionNote}</p>}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
