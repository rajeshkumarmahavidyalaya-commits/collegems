"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, SquarePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportRowsButton } from "@/components/export-rows-button";

export type NamedListRow = { id: string; name: string; students: number };

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

type Words = {
  /** "Mediums" */
  title: string;
  /** "Medium" */
  one: string;
  /** "Enter medium" */
  placeholder: string;
  /** What uses one, for the count column: "Students" (the default) or "Subjects". */
  usedBy?: string;
};

/**
 * The reference's Manage Medium and Manage House: the list on the left, the
 * add form on the right. The two writes arrive as props -- a server action is
 * a serialisable reference -- so this shares the screen and each page keeps
 * its own authorisation (rule 8's split, applied to a list).
 */
export function NamedListManager({
  rows,
  words,
  canManage,
  save,
  remove,
}: {
  rows: NamedListRow[];
  words: Words;
  canManage: boolean;
  save: (name: string, id?: string) => Promise<Result<{ id: string }>>;
  remove: (id: string) => Promise<Result>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<NamedListRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = name.trim();
    if (!value) {
      setError(`Enter the ${words.one.toLowerCase()} name.`);
      return;
    }
    startTransition(async () => {
      const r = await save(value, editing?.id);
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      toast.success(editing ? `${words.one} renamed to "${value}".` : `${words.one} "${value}" added.`);
      setName("");
      setEditing(null);
      router.refresh();
    });
  }

  function del(row: NamedListRow) {
    if (!window.confirm(`Remove ${words.one.toLowerCase()} "${row.name}"?`)) return;
    startTransition(async () => {
      const r = await remove(row.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${words.one} "${row.name}" removed.`);
      if (editing?.id === row.id) {
        setEditing(null);
        setName("");
      }
      router.refresh();
    });
  }

  const inputId = `named-${words.one.toLowerCase().replace(/\W+/g, "-")}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
      <section className="min-w-0 rounded-lg border bg-card p-4" aria-labelledby={`${inputId}-list`}>
        <div className="mb-3 flex flex-wrap items-center gap-3 border-b pb-3">
          <h2 id={`${inputId}-list`} className="text-lg font-semibold">
            {words.title}
          </h2>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <ExportRowsButton
              rows={[["#", words.one, words.usedBy ?? "Students"], ...rows.map((r, i) => [String(i + 1), r.name, String(r.students)])]}
              fileName={`${words.title.toLowerCase()}.csv`}
            />
            <Label htmlFor={`${inputId}-search`} className="text-sm font-normal">
              Search
            </Label>
            <Input
              id={`${inputId}-search`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-44"
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-medium">No {words.title.toLowerCase()} yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canManage
                ? `Add the first one with the form beside this list.`
                : "An administrator adds them here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{words.one}</TableHead>
                  <TableHead className="text-end">{words.usedBy ?? "Students"}</TableHead>
                  <TableHead className="w-32">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      Nothing matches &ldquo;{search}&rdquo;.
                    </TableCell>
                  </TableRow>
                ) : (
                  shown.map((r, i) => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-end tabular-nums">{r.students}</TableCell>
                      <TableCell>
                        {canManage ? (
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Rename ${r.name}`}
                              onClick={() => {
                                setEditing(r);
                                setName(r.name);
                                setError(null);
                                document.getElementById(inputId)?.focus();
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
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card p-4" aria-labelledby={`${inputId}-form`}>
        <h2 id={`${inputId}-form`} className="mb-3 flex items-center gap-2 border-b pb-3 text-lg font-semibold">
          <SquarePlus className="size-5 text-primary" aria-hidden="true" />
          {editing ? `Rename ${words.one}` : `Add New ${words.one}`}
        </h2>
        {canManage ? (
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>{words.one}:</Label>
              <Input
                id={inputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={words.placeholder}
                maxLength={60}
                // Locked while a save is running: finishing it clears the box,
                // which would otherwise take a second name typed meanwhile.
                disabled={pending}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${inputId}-error` : undefined}
              />
              {error && (
                <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setName("");
                    setError(null);
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                {editing ? "Save" : `Add New ${words.one}`}
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Only an administrator can add or rename these.</p>
        )}
      </section>
    </div>
  );
}
