"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type PickedStudent = {
  id: string;
  name: string;
  admissionNumber: string;
  status: string;
};

/**
 * Choose one child out of a roll, by name or admission number.
 *
 * ## Why this is a component and not a `<Select>`
 *
 * Two screens loaded the whole roll into a flat dropdown and each was wrong in
 * its own way, measured on this college's **302** students:
 *
 * | screen | what it did | who it could reach |
 * |---|---|---|
 * | `/certificates/issue` | `.order("admission_number").limit(20)` | **20 of 302** |
 * | `/fees/concessions` | `.limit(500)`, every page view | 302, in one dropdown |
 *
 * The first is a defect today. The second is a defect at 501 students and a
 * 302-item scroll before then — **the same mistake with a more generous
 * bound**, which is why it read as fine.
 *
 * ## The search is the server's
 *
 * `shouldFilter={false}`: cmdk's own fuzzy filter would run *again* over an
 * answer the database already narrowed, and would drop a child whose name
 * matches on the server and not in the browser.
 *
 * ## It takes the action rather than importing one
 *
 * A server action is a serialisable reference, so the caller passes its own —
 * which is rule 8's split applied to a picker: **the choreography is shared and
 * the authorization is not.** Both callers happen to reach `student_search`
 * today, and a screen that must narrow the roll further (to one section, to
 * children with an unpaid balance) supplies a different action without this
 * component learning about it.
 */
export function StudentPicker({
  id,
  selected,
  onSelect,
  search,
  placeholder = "Search by name or admission number",
}: {
  id: string;
  selected: PickedStudent | null;
  onSelect: (student: PickedStudent) => void;
  /** The caller's own server action. Returns at most a screenful. */
  search: (term: string) => Promise<PickedStudent[]>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<PickedStudent[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    const needle = term.trim();
    if (needle.length < 2) {
      setRows([]);
      return;
    }
    // Settle first: every keystroke would otherwise be a round trip.
    const handle = setTimeout(() => {
      startSearch(async () => setRows(await search(needle)));
    }, 250);
    return () => clearTimeout(handle);
    // `search` is a stable server-action reference; re-running on it would
    // refetch on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-normal"
        >
          {/* A name and an admission number are data, and a school with an Urdu
              interface still has Latin-script names in it: `dir="auto"` lets
              each value declare its own run rather than inheriting the page's. */}
          <span dir="auto" className={selected ? undefined : "text-muted-foreground"}>
            {selected ? studentLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={term} onValueChange={setTerm} />
          <CommandList>
            {searching && (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            )}
            {!searching && (
              <CommandEmpty>
                {term.trim().length < 2
                  ? "Type at least two characters."
                  : "Nobody matched that search."}
              </CommandEmpty>
            )}
            {rows.length > 0 && (
              <CommandGroup>
                {rows.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={row.id}
                    onSelect={() => {
                      onSelect(row);
                      setOpen(false);
                    }}
                  >
                    <span dir="auto">{studentLabel(row)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One line for a child: who they are, their reference, and anything unusual. */
export function studentLabel(student: PickedStudent): string {
  return `${student.name} · ${student.admissionNumber}${
    student.status !== "active" ? ` · ${student.status}` : ""
  }`;
}
