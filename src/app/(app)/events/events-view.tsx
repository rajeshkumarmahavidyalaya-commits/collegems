"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarHeart, Loader2, Pencil, Plus, SquarePlus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/components/providers/i18n-provider";
import { deleteEvent, saveEvent, type EventRow } from "./actions";

const EMPTY = { title: "", eventDate: "", description: "", isActive: true };

/**
 * The reference's Events for the office: Event Title, Event Date, Total
 * Participants, Is Active, Action, beside "Add New Event" (title, date,
 * description, Approved / Active or Inactive). The writes are the
 * administrator's; everybody else reads.
 */
export function EventsView({ rows, canManage }: { rows: EventRow[]; canManage: boolean }) {
  const { formatDate } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveEvent(form, editing?.id);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.error);
        return;
      }
      toast.success(editing ? `Event "${form.title.trim()}" saved.` : `Event "${form.title.trim()}" added.`);
      reset();
      router.refresh();
    });
  }

  function del(row: EventRow) {
    const who = row.participants === 1 ? "1 participant" : `${row.participants} participants`;
    if (!window.confirm(`Remove "${row.title}"? Its list of ${who} goes with it.`)) return;
    start(async () => {
      const r = await deleteEvent(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Event "${row.title}" removed.`);
      if (editing?.id === row.id) reset();
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-labelledby="events-list">
        <h2 id="events-list" className="mb-3 border-b pb-3 text-lg font-semibold">
          Events
        </h2>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <CalendarHeart className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No events this year.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {canManage
                ? "Add a sports day, a science fair or an annual function. Active events appear on the school calendar, and families can put their children on them."
                : "Events the college adds appear here and on the school calendar."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event Title</TableHead>
                  <TableHead>Event Date</TableHead>
                  <TableHead className="text-end">Total Participants</TableHead>
                  <TableHead>Is Active</TableHead>
                  <TableHead className="w-36">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/events/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                        {r.title}
                      </Link>
                      {r.description && (
                        <span className="block max-w-80 truncate text-xs text-muted-foreground">{r.description}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(r.eventDate)}</TableCell>
                    <TableCell className="text-end tabular-nums">{r.participants}</TableCell>
                    <TableCell>
                      <Badge variant={r.isActive ? "success" : "outline"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button asChild size="icon" variant="ghost" aria-label={`Participants of ${r.title}`}>
                          <Link href={`/events/${r.id}`}>
                            <Users className="size-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit ${r.title}`}
                              onClick={() => {
                                setEditing(r);
                                setForm({
                                  title: r.title,
                                  eventDate: r.eventDate,
                                  description: r.description ?? "",
                                  isActive: r.isActive,
                                });
                                setErrors({});
                                setError(null);
                                document.getElementById("event-title")?.focus();
                              }}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${r.title}`}
                              disabled={pending}
                              onClick={() => del(r)}
                            >
                              <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4" aria-labelledby="event-form">
        <h2 id="event-form" className="mb-3 flex items-center gap-2 border-b pb-3 text-lg font-semibold">
          <SquarePlus className="size-5 text-primary" aria-hidden="true" />
          {editing ? "Edit Event" : "Add New Event"}
        </h2>
        {canManage ? (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-title">Event Title:</Label>
              <Input
                id="event-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                maxLength={150}
                disabled={pending}
                aria-invalid={Boolean(errors.title)}
              />
              {errors.title && <p className="text-sm text-destructive">{errors.title[0]}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-date">Event Date:</Label>
              <Input
                id="event-date"
                type="date"
                value={form.eventDate}
                onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))}
                disabled={pending}
                aria-invalid={Boolean(errors.eventDate)}
              />
              {errors.eventDate && <p className="text-sm text-destructive">{errors.eventDate[0]}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-description">Event Description:</Label>
              <Textarea
                id="event-description"
                rows={4}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={4000}
                disabled={pending}
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Status:</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="event-status"
                    checked={form.isActive}
                    onChange={() => setForm((f) => ({ ...f, isActive: true }))}
                  />
                  Approved / Active
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="event-status"
                    checked={!form.isActive}
                    onChange={() => setForm((f) => ({ ...f, isActive: false }))}
                  />
                  Inactive
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                An inactive event stays on this list and is not on the calendar or offered to families.
              </p>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {editing && (
                <Button type="button" variant="ghost" onClick={reset}>
                  <X className="size-4" aria-hidden="true" />
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                {editing ? "Save" : "Add New Event"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only an administrator can add or change events.</p>
        )}
      </section>
    </div>
  );
}
