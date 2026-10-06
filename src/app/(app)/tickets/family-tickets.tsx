"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, Ticket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import { ticketPriorityLabel, ticketStatusLabel } from "@/lib/validations/tickets-display";
import { raiseTicket, type TicketRow } from "./actions";

const NONE = "__none";

/**
 * A family's Support Tickets: their own child's tickets, whoever raised them,
 * and a form to raise one (`ticket_raise`). What happens next is the office's.
 */
export function FamilyTickets({
  rows,
  childList,
  subjects,
}: {
  rows: TicketRow[];
  childList: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
}) {
  const { formatDate, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [studentId, setStudentId] = useState(childList[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Give the ticket a title.");
    start(async () => {
      const r = await raiseTicket(studentId, title, description, subjectId);
      if (!r.ok) return setError(r.error);
      toast.success("Your ticket is raised. The college will reply here.");
      setTitle("");
      setDescription("");
      setSubjectId("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <section className="min-w-0 flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="my-tickets">
        <h2 id="my-tickets" className="border-b pb-3 text-lg font-semibold">
          Support Tickets
        </h2>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Ticket className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No tickets yet.</p>
            <p className="max-w-md text-sm text-muted-foreground">A ticket you raise, or one the college opens about your child, appears here.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <Badge variant={r.status === "resolved" || r.status === "closed" ? "success" : r.status === "in_progress" ? "warning" : "outline"}>
                    {ticketStatusLabel(r.status, t)}
                  </Badge>
                  <Badge variant="secondary">{ticketPriorityLabel(r.priority, t)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.studentName}
                  {r.subjectName ? ` · ${r.subjectName}` : ""} · raised {formatDate(r.createdAt)}
                  {r.dueOn ? ` · due ${formatDate(r.dueOn)}` : ""}
                  {r.raisedByFamily ? " · by you" : " · by the college"}
                </p>
                {r.description && <p className="whitespace-pre-line text-sm">{r.description}</p>}
                {r.resolutionNote && (
                  <p className="rounded-md bg-muted px-3 py-2 text-sm">
                    <span className="font-medium">College: </span>
                    {r.resolutionNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4" aria-labelledby="raise-ticket">
        <h2 id="raise-ticket" className="mb-3 border-b pb-3 text-lg font-semibold">
          Raise a ticket
        </h2>
        {childList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No children are linked to this login yet. Ask the college office.</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {childList.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ticket-child">Child</Label>
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger id="ticket-child" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {childList.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-ticket-title">Title</Label>
              <Input id="family-ticket-title" value={title} maxLength={150} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-ticket-subject">Subject (optional)</Label>
              <Select value={subjectId || NONE} onValueChange={(v) => setSubjectId(v === NONE ? "" : v)}>
                <SelectTrigger id="family-ticket-subject" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="family-ticket-description">What is it about?</Label>
              <Textarea id="family-ticket-description" rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              Raise ticket
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
