"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListPlus, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDefaultLeaveTypes, saveLeaveType, type LeaveTypeRow } from "../actions";

type Draft = { code: string; name: string; annualQuotaDays: string; isPaid: boolean; allowsHalfDay: boolean; isActive: boolean };
const blank: Draft = { code: "", name: "", annualQuotaDays: "", isPaid: true, allowsHalfDay: true, isActive: true };

/**
 * The kinds of staff leave a college offers. `saveLeaveType` existed with no
 * caller (0333's sweep), so a college without leave types -- every college
 * founded through the product, until that migration -- could never let a
 * member of staff apply. Drawn for the administrator, the one role the
 * `leave_types` write policy admits.
 */
export function LeaveTypesCard({ types }: { types: LeaveTypeRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | "new" | null>(types.length ? null : "new");
  const [draft, setDraft] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function open(row?: LeaveTypeRow) {
    setErrors({});
    setEditing(row?.id ?? "new");
    setDraft(
      row
        ? {
            code: row.code,
            name: row.name,
            annualQuotaDays: row.annualQuotaDays === null ? "" : String(row.annualQuotaDays),
            isPaid: row.isPaid,
            allowsHalfDay: row.allowsHalfDay,
            isActive: row.isActive,
          }
        : blank,
    );
  }

  function save() {
    start(async () => {
      const r = await saveLeaveType(draft, editing && editing !== "new" ? editing : undefined);
      if (!r.ok) {
        setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])));
        toast.error(r.error);
        return;
      }
      toast.success(editing === "new" ? `"${draft.name}" added to the kinds of leave.` : `"${draft.name}" saved.`);
      setEditing(null);
      router.refresh();
    });
  }

  function addUsual() {
    start(async () => {
      const r = await addDefaultLeaveTypes();
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        r.data.added
          ? `Added ${r.data.added} ${r.data.added === 1 ? "kind" : "kinds"} of leave.`
          : "This college already has all the usual kinds of leave.",
      );
      setEditing(null);
      router.refresh();
    });
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`lt-${k}-error`} className="text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Kinds of leave</CardTitle>
          <CardDescription>
            {types.length
              ? "What staff can apply for, with the yearly allowance. Blank allowance means as much as is approved."
              : "There are no kinds of leave yet, so nobody can apply. Add the usual four, or your own."}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={addUsual}>
            <ListPlus className="size-4" aria-hidden="true" />
            Add the usual kinds
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => open()}>
            <Plus className="size-4" aria-hidden="true" />
            New kind
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {types.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-end">Days a year</TableHead>
                  <TableHead>Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono">{t.code}</TableCell>
                    <TableCell>{t.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{t.annualQuotaDays ?? "As approved"}</TableCell>
                    <TableCell>{t.isPaid ? "Paid" : "Unpaid"}</TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? "secondary" : "outline"}>{t.isActive ? "Offered" : "Retired"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => open(t)}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {editing && (
          <form
            className="grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-[8rem_minmax(0,1fr)_9rem]"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-code">Code</Label>
              <Input
                id="lt-code"
                value={draft.code}
                maxLength={12}
                placeholder="CL"
                aria-invalid={Boolean(errors.code)}
                aria-describedby={errors.code ? "lt-code-error" : undefined}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              />
              {err("code")}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-name">Name</Label>
              <Input
                id="lt-name"
                value={draft.name}
                maxLength={60}
                placeholder="Casual leave"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "lt-name-error" : undefined}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {err("name")}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-quota">Days a year</Label>
              <Input
                id="lt-quota"
                inputMode="decimal"
                value={draft.annualQuotaDays}
                placeholder="As approved"
                aria-invalid={Boolean(errors.annualQuotaDays)}
                aria-describedby={errors.annualQuotaDays ? "lt-annualQuotaDays-error" : undefined}
                onChange={(e) => setDraft({ ...draft, annualQuotaDays: e.target.value })}
              />
              {err("annualQuotaDays")}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-3">
              {(
                [
                  ["isPaid", "Paid"],
                  ["allowsHalfDay", "Half days allowed"],
                  ["isActive", "Offered"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={draft[k]} onCheckedChange={(v) => setDraft({ ...draft, [k]: v === true })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-3">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                <X className="size-4" aria-hidden="true" />
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {editing === "new" ? "Add kind of leave" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
