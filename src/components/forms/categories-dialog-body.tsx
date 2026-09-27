"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Result = { ok: boolean; error?: string };

/**
 * The dialog half of `CategoriesDialog`, loaded on the click that opens it
 * (see `categories-dialog.tsx`).
 *
 * A short named list somebody needs to add to, rename and prune (0289): book
 * categories, which nothing could create, and store categories, which could be
 * added and never renamed or removed.
 *
 * The actions are props (rule 8's split): each module's server action keeps
 * its own policy and its own sentence about what deleting leaves behind.
 */
export default function CategoriesDialogBody({
  title,
  description,
  categories,
  save,
  remove,
  deleteNote,
  open,
  onOpenChange,
}: {
  title: string;
  description: string;
  categories: { id: string; name: string }[];
  save: (name: string, id?: string) => Promise<Result>;
  remove: (id: string) => Promise<Result>;
  /** What happens to things in a deleted category, for the confirmation. */
  deleteNote: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        toast.error(result.error ?? "Not saved.");
        return;
      }
      toast.success(done);
      setName("");
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) run(() => save(name), `${name.trim()} added.`);
            }}
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-category">New category</Label>
              <Input id="new-category" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fiction" />
            </div>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
              Add
            </Button>
          </form>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  {editing?.id === c.id ? (
                    <>
                      <Input
                        aria-label={`New name for ${c.name}`}
                        value={editing.name}
                        onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                        className="h-8"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Save"
                        disabled={pending}
                        onClick={() => run(() => save(editing.name, c.id), "Category renamed.")}
                      >
                        <Check className="size-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1">{c.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Rename ${c.name}`}
                        onClick={() => setEditing({ id: c.id, name: c.name })}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${c.name}`}
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Delete the ${c.name} category? ${deleteNote}`)) {
                            run(() => remove(c.id), `${c.name} deleted.`);
                          }
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
