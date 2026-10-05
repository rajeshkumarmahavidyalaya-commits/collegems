"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

/**
 * A confirmed delete for a record entered by mistake: a book, a route, a
 * schedule, an attachment, an account. Several of these had a server action
 * and no button (the 0333 sweep of actions nothing calls).
 *
 * The database decides, not this dialog: where a row has history the delete
 * is refused (a foreign key, a trigger, a policy) and that sentence is shown
 * here in place, rather than a toast that vanishes. The action is a prop, so
 * each caller keeps its own checks.
 */
export function ConfirmDeleteButton({
  label,
  title,
  description,
  action,
  success,
  afterDelete,
  size = "sm",
  iconOnly = false,
  onDeleted,
}: {
  /** The button's words, e.g. "Delete book". */
  label: string;
  title: string;
  description: string;
  action: () => Promise<Result>;
  /** The toast once it is gone. */
  success: string;
  /** Where to go once the record no longer exists; omitted, the page refreshes. */
  afterDelete?: string;
  size?: "sm" | "default" | "icon";
  iconOnly?: boolean;
  /** Called once it is gone, e.g. to close the dialog the button sits in. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setRefusal(null);
    start(async () => {
      const r = await action();
      if (!r.ok) {
        setRefusal(r.error);
        return;
      }
      setOpen(false);
      toast.success(success);
      onDeleted?.();
      if (afterDelete) router.push(afterDelete);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        size={iconOnly ? "icon" : size}
        variant={iconOnly ? "ghost" : "outline"}
        className={iconOnly ? undefined : "border-destructive text-destructive"}
        aria-label={iconOnly ? label : undefined}
        onClick={() => {
          setRefusal(null);
          setOpen(true);
        }}
      >
        <Trash2 className={iconOnly ? "size-4 text-destructive" : "size-4"} aria-hidden="true" />
        {!iconOnly && label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {refusal && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Not deleted</AlertTitle>
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
