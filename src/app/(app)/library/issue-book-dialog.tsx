"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { issueBook, listIssuableMembers } from "./actions";

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export function IssueBookDialog({ bookId, bookTitle }: { bookId: string; bookTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<{ id: string; label: string }[]>([]);
  const [memberId, setMemberId] = useState("");
  const [dueAt, setDueAt] = useState(defaultDueDate());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listIssuableMembers("").then(setMembers);
  }, [open]);

  async function onSubmit() {
    setError(null);
    setIsSubmitting(true);
    const result = await issueBook({ bookId, memberId, dueAt });
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(`"${bookTitle}" issued`);
    setOpen(false);
    setMemberId("");
    setDueAt(defaultDueDate());
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <BookUp className="size-4" aria-hidden="true" />
          Issue book
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue this book</DialogTitle>
          <DialogDescription className="text-balance">{bookTitle}</DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="issue-member">Member</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="issue-member" className="w-full">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="issue-due">Due date</Label>
            <Input
              id="issue-due"
              type="date"
              value={dueAt}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!memberId || !dueAt || isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
