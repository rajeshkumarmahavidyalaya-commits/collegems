"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, SquarePlus, Trash2, Trophy, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/components/providers/i18n-provider";
import { removeActivity, saveActivity, type ActivityOptions, type ActivityRow } from "./actions";

const EMPTY = { name: "", classLevelId: "", fee: "", feeHeadId: "", description: "", isActive: true };
const ALL = "__all";
const NONE = "__none";

/**
 * The reference's Activities: Name, Class, Fee, Description, Status, Action,
 * beside "Add Student Activity" (Title, Fees, Class, Description, Status).
 * The writes are the administrator's; everybody else reads. A fee is billed
 * under a fee type, so the form asks for one when the fee is not zero.
 */
export function ActivitiesView({
  rows,
  options,
  canManage,
}: {
  rows: ActivityRow[];
  options: ActivityOptions;
  canManage: boolean;
}) {
  const { formatCurrency } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ActivityRow | null>(null);
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
      const r = await saveActivity(form, editing?.id);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.error);
        return;
      }
      toast.success(editing ? `Activity "${form.name.trim()}" saved.` : `Activity "${form.name.trim()}" added.`);
      reset();
      router.refresh();
    });
  }

  function del(row: ActivityRow) {
    if (!window.confirm(`Remove "${row.name}"?`)) return;
    start(async () => {
      const r = await removeActivity(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Activity "${row.name}" removed.`);
      if (editing?.id === row.id) reset();
      router.refresh();
    });
  }

  const feeNumber = Number(form.fee || 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-labelledby="activities-list">
        <h2 id="activities-list" className="mb-3 border-b pb-3 text-lg font-semibold">
          Activities
        </h2>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Trophy className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No activities this year.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {canManage
                ? "Add a club or a class with its fee. Putting a student on it raises the fee on their account."
                : "Activities the college adds appear here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-end">Fee</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-end">Students</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-36">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/activities/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>{r.className ?? "All classes"}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {r.fee > 0 ? formatCurrency(r.fee) : "Free"}
                      {r.feeHeadName && r.fee > 0 && <span className="block text-xs text-muted-foreground">{r.feeHeadName}</span>}
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-72 truncate text-sm text-muted-foreground">{r.description ?? "—"}</span>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{r.participants}</TableCell>
                    <TableCell>
                      <Badge variant={r.isActive ? "success" : "outline"}>{r.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button asChild size="icon" variant="ghost" aria-label={`Students on ${r.name}`}>
                          <Link href={`/activities/${r.id}`}>
                            <Users className="size-4" aria-hidden="true" />
                          </Link>
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit ${r.name}`}
                              onClick={() => {
                                setEditing(r);
                                setForm({
                                  name: r.name,
                                  classLevelId: r.classLevelId ?? "",
                                  fee: r.fee ? String(r.fee) : "",
                                  feeHeadId: r.feeHeadId ?? "",
                                  description: r.description ?? "",
                                  isActive: r.isActive,
                                });
                                setErrors({});
                                setError(null);
                                document.getElementById("activity-name")?.focus();
                              }}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${r.name}`}
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

      <section className="rounded-lg border bg-card p-4" aria-labelledby="activity-form">
        <h2 id="activity-form" className="mb-3 flex items-center gap-2 border-b pb-3 text-lg font-semibold">
          <SquarePlus className="size-5 text-primary" aria-hidden="true" />
          {editing ? "Edit Activity" : "Add Student Activity"}
        </h2>
        {canManage ? (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activity-name">Title:</Label>
              <Input
                id="activity-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={120}
                disabled={pending}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name[0]}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activity-class">Class:</Label>
              <Select value={form.classLevelId || ALL} onValueChange={(v) => setForm((f) => ({ ...f, classLevelId: v === ALL ? "" : v }))}>
                <SelectTrigger id="activity-class" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All classes</SelectItem>
                  {options.classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="activity-fee">Fees:</Label>
                <Input
                  id="activity-fee"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.fee}
                  onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                  disabled={pending}
                  aria-invalid={Boolean(errors.fee)}
                />
                {errors.fee && <p className="text-sm text-destructive">{errors.fee[0]}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="activity-head">Fee type:</Label>
                <Select value={form.feeHeadId || NONE} onValueChange={(v) => setForm((f) => ({ ...f, feeHeadId: v === NONE ? "" : v }))}>
                  <SelectTrigger id="activity-head" className="w-full" aria-invalid={Boolean(errors.feeHeadId)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {options.feeHeads.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.feeHeadId ? (
                  <p className="text-sm text-destructive">{errors.feeHeadId[0]}</p>
                ) : (
                  feeNumber > 0 && <p className="text-xs text-muted-foreground">The invoice line is filed under it.</p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="activity-description">Description:</Label>
              <Textarea
                id="activity-description"
                rows={3}
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
                  <input type="radio" name="activity-status" checked={form.isActive} onChange={() => setForm((f) => ({ ...f, isActive: true }))} />
                  Active
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="activity-status" checked={!form.isActive} onChange={() => setForm((f) => ({ ...f, isActive: false }))} />
                  Inactive
                </label>
              </div>
              <p className="text-xs text-muted-foreground">An inactive activity takes no new students.</p>
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
                {editing ? "Save" : "Add Student Activity"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only an administrator can add or change activities.</p>
        )}
      </section>
    </div>
  );
}
