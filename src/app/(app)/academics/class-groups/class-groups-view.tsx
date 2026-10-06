"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, SquarePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  removeClassGroup,
  saveClassGroup,
  type ClassGroupRow,
  type ClassLevelOption,
} from "../class-group-actions";

/**
 * The reference's Class Groups: Class Group Name, Classes, Head of Group,
 * beside a form that names the group, its head and its classes. A class is in
 * one group at most, so ticking a class already in another group moves it,
 * and the form says which group it comes from.
 */
export function ClassGroupsView({
  groups,
  classes,
  staff,
  canManage,
}: {
  groups: ClassGroupRow[];
  classes: ClassLevelOption[];
  staff: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ClassGroupRow | null>(null);
  const [name, setName] = useState("");
  const [head, setHead] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  function reset() {
    setEditing(null);
    setName("");
    setHead("");
    setPicked(new Set());
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Enter the class group name.");
    start(async () => {
      const r = await saveClassGroup({ name, headStaffId: head, classLevelIds: [...picked] }, editing?.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(
        `Class group "${name.trim()}" ${editing ? "saved" : "added"} with ${
          picked.size === 1 ? "1 class" : `${picked.size} classes`
        }.`,
      );
      reset();
      router.refresh();
    });
  }

  function del(row: ClassGroupRow) {
    if (!window.confirm(`Remove the class group "${row.name}"? Its classes stay, ungrouped.`)) return;
    start(async () => {
      const r = await removeClassGroup(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Class group "${row.name}" removed. Its classes are ungrouped.`);
      if (editing?.id === row.id) reset();
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-labelledby="class-groups-list">
        <h2 id="class-groups-list" className="mb-3 border-b pb-3 text-lg font-semibold">
          Class Groups
        </h2>
        {groups.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-medium">No class groups yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canManage
                ? "Group classes, such as Science or Primary, under a member of staff who heads them."
                : "An administrator adds them here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Class Group Name</TableHead>
                  <TableHead>Classes</TableHead>
                  <TableHead>Head of Group</TableHead>
                  <TableHead className="w-28">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g, i) => (
                  <TableRow key={g.id}>
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell>
                      {g.classes.length === 0 ? (
                        <span className="text-sm text-muted-foreground">No classes</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {g.classes.map((c) => (
                            <Badge key={c.id} variant="secondary">
                              {c.name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{g.headName ?? <span className="text-muted-foreground">Not set</span>}</TableCell>
                    <TableCell>
                      {canManage ? (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Edit ${g.name}`}
                            onClick={() => {
                              setEditing(g);
                              setName(g.name);
                              setHead(g.headStaffId ?? "");
                              setPicked(new Set(g.classes.map((c) => c.id)));
                              setError(null);
                              document.getElementById("class-group-name")?.focus();
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${g.name}`}
                            disabled={pending}
                            onClick={() => del(g)}
                          >
                            <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
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
      </section>

      <section className="rounded-lg border bg-card p-4" aria-labelledby="class-group-form">
        <h2 id="class-group-form" className="mb-3 flex items-center gap-2 border-b pb-3 text-lg font-semibold">
          <SquarePlus className="size-5 text-primary" aria-hidden="true" />
          {editing ? "Edit Class Group" : "Add New Class Group"}
        </h2>
        {canManage ? (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="class-group-name">Class Group Name:</Label>
              <Input
                id="class-group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Science"
                maxLength={80}
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "class-group-error" : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="class-group-head">Head of Group:</Label>
              <select
                id="class-group-head"
                value={head}
                onChange={(e) => setHead(e.target.value)}
                disabled={pending}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Not set</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Classes:</legend>
              {classes.length === 0 ? (
                <p className="text-sm text-muted-foreground">This college has no classes yet.</p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {classes.map((c) => {
                    const elsewhere = c.groupId && c.groupId !== editing?.id ? groupName.get(c.groupId) : null;
                    return (
                      <label key={c.id} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={picked.has(c.id)}
                          disabled={pending}
                          onChange={(e) =>
                            setPicked((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                        />
                        <span>
                          {c.name}
                          {elsewhere && (
                            <span className="block text-xs text-muted-foreground">
                              {picked.has(c.id) ? `Moves from ${elsewhere}` : `In ${elsewhere}`}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
            {error && (
              <p id="class-group-error" role="alert" className="text-sm text-destructive">
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
                {editing ? "Save" : "Add New Class Group"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only an administrator can add or change class groups.</p>
        )}
      </section>
    </div>
  );
}
