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

type Result = { ok: true; data: { name: string } } | { ok: false; error: string };

/**
 * Deleting a student or staff record entered by mistake (0288).
 *
 * The database decides, not this dialog: a record with history -- fees,
 * register, marks, payslips -- is refused by a trigger in a sentence naming
 * what the school holds, and that sentence is shown here in place. The dialog's
 * job is to say so *before* the click, so nobody reaches for Delete when the
 * person has simply left.
 *
 * The action is a prop, like the photo control's: the two callers' actions
 * each keep their own checks (rule 8's split, applied to a button).
 */
export function DeleteRecordControl({
  name,
  kind,
  action,
  afterDelete,
}: {
  name: string;
  kind: "student" | "staff";
  action: () => Promise<Result>;
  /** Where to go once the record no longer exists. */
  afterDelete: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setRefusal(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setRefusal(result.error);
        return;
      }
      setOpen(false);
      toast.success(`${result.data.name} was deleted.`);
      router.push(afterDelete);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          setRefusal(null);
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              Only for a record entered by mistake -- a duplicate, or somebody added to the wrong
              college. It removes them completely
              {kind === "student" ? ", with any guardian who has no other child here" : ""}.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            If {kind === "student" ? "the child" : "they"} actually{" "}
            {kind === "student" ? "left the college" : "left the job"}, use{" "}
            <span className="font-medium text-foreground">Record leaving</span> instead. Anybody the
            college holds fees, attendance, marks, payslips or other records for cannot be deleted,
            and you will be told what is held.
          </p>

          <div aria-live="polite">
            {refusal && (
              <Alert variant="destructive">
                <AlertTitle>Not deleted</AlertTitle>
                <AlertDescription>{refusal}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={pending || refusal !== null}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
