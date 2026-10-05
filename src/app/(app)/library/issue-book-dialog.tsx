"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookUp, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { issueBook, searchBooksForIssue, searchMembersForIssue, type IssuePick } from "./actions";

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

/**
 * Issue a book, from wherever the librarian is standing.
 *
 * From a book's page the book is fixed. From the issues counter -- where the
 * home page's *Issue a book* lands -- both the book and the borrower are found
 * by typing, which is what a counter is for: before 0292 issuing meant Catalog,
 * find the book, open it, then Issue, and the borrower list held the first
 * twenty cards of the roll and nobody else.
 */
export function IssueBookDialog({
  book,
  defaultOpen = false,
  compact = false,
  onIssued,
}: {
  book?: { id: string; title: string };
  defaultOpen?: boolean;
  /** A small outline button, for a table row (the catalogue's Issue Book column). */
  compact?: boolean;
  /** Called after a successful issue, e.g. to re-read a client-paged list. */
  onIssued?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [picked, setPicked] = useState<IssuePick | null>(
    book ? { id: book.id, label: book.title, detail: "" } : null,
  );
  const [member, setMember] = useState<IssuePick | null>(null);
  const [dueAt, setDueAt] = useState(defaultDueDate());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPicked(book ? { id: book.id, label: book.title, detail: "" } : null);
    setMember(null);
    setDueAt(defaultDueDate());
    setError(null);
  }

  async function onSubmit() {
    if (!picked || !member) return;
    setError(null);
    setIsSubmitting(true);
    const result = await issueBook({ bookId: picked.id, memberId: member.id, dueAt });
    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(`"${picked.label}" issued to ${member.label}`);
    // Stay open on the counter with the borrower kept: the next thing a
    // librarian does is usually a second book for the same child.
    if (book) {
      setOpen(false);
      reset();
    } else {
      setPicked(null);
    }
    onIssued?.();
    router.refresh();
  }

  return (
    <>
      <Button
        size={compact ? "sm" : "default"}
        variant={compact ? "outline" : "default"}
        aria-label={compact && book ? `Issue ${book.title}` : undefined}
        onClick={() => setOpen(true)}
      >
        <BookUp className="size-4" aria-hidden="true" />
        Issue Book
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Book</DialogTitle>
            <DialogDescription>
              {book ? book.title : "Type part of the title, then part of the borrower's name or card number."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="grid gap-4">
            {!book && (
              <Picker
                id="issue-book"
                label="Book"
                placeholder="Title, author, ISBN or book number"
                empty="No book with a copy on the shelf matches that."
                picked={picked}
                onPick={setPicked}
                search={searchBooksForIssue}
              />
            )}
            <Picker
              id="issue-member"
              label="Borrower"
              placeholder="Name, card, admission number or employee code"
              empty="No active library card matches that. Add them under Library, Members."
              picked={member}
              onPick={setMember}
              search={searchMembersForIssue}
            />
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
              {book ? "Cancel" : "Done"}
            </Button>
            <Button onClick={onSubmit} disabled={!picked || !member || !dueAt || isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Type two letters, pick one. The action is a prop: the picker decides nothing about who may see what. */
function Picker({
  id,
  label,
  placeholder,
  empty,
  picked,
  onPick,
  search,
}: {
  id: string;
  label: string;
  placeholder: string;
  empty: string;
  picked: IssuePick | null;
  onPick: (p: IssuePick | null) => void;
  search: (term: string) => Promise<IssuePick[]>;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<IssuePick[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (picked || term.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void search(term).then((r) => {
        if (!live) return;
        setResults(r);
        setSearching(false);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, picked, search]);

  if (picked) {
    return (
      <div className="grid gap-2">
        <Label>{label}</Label>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{picked.label}</span>
            {picked.detail && <span className="block truncate text-xs text-muted-foreground">{picked.detail}</span>}
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Change ${label.toLowerCase()}`}
            onClick={() => {
              onPick(null);
              setTerm("");
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input
          id={id}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder}
          className="ps-8"
          autoComplete="off"
        />
      </div>
      <div aria-live="polite" className="text-sm">
        {searching ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Searching…
          </span>
        ) : term.trim().length >= 2 && results.length === 0 ? (
          <span className="text-muted-foreground">{empty}</span>
        ) : null}
      </div>
      {results.length > 0 && (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                className="block w-full px-3 py-2 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="block truncate text-sm font-medium">{r.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
