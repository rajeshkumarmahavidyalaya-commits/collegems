"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectField, TextField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import { guardianSchema, type GuardianInput } from "@/lib/validations/guardians";
import { addGuardian, linkGuardian, searchGuardians, updateGuardian } from "../guardian-actions";
import type { GuardianSearchResult } from "../guardian-actions";

/**
 * The two dialogs behind the guardians card.
 *
 * Neither takes `useI18n`. The relationship names arrive as a prop, computed
 * on the server with `await getT()` — the `PhotoControl` lesson from the ID-card
 * batch, where the hook cost a route **22 kB** and the prop cost it **1 kB**.
 * Measured here the same way: `/students/[id]` was 167 kB as a pure Server
 * Component, 217 kB with `useI18n()` in the card, and **170 kB** with the
 * labels passed in. The catalogue is one 57 kB chunk, and a route that does not
 * already speak on the client pays all of it for a badge.
 *
 * In their own module because *a conditional render is not a conditional load*:
 * `{open && <Dialog/>}` in the card would ship react-hook-form, Zod's resolver
 * and the search box to every visitor of every student page and then not draw
 * them. The card imports this through `next/dynamic`, so it arrives on the
 * click that opens it.
 */

const EMPTY: GuardianInput = {
  firstName: "",
  middleName: "",
  lastName: "",
  phone: "",
  email: "",
  addressLine1: "",
  city: "",
  state: "",
  occupation: "",
  relationship: "guardian",
  isPrimary: false,
  canPickup: true,
};

export type GuardianDraft = GuardianInput & { guardianId: string };

function LinkFlags({
  isPrimary,
  canPickup,
  onPrimary,
  onPickup,
}: {
  isPrimary: boolean;
  canPickup: boolean;
  onPrimary: (v: boolean) => void;
  onPickup: (v: boolean) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="guardian-primary"
          checked={isPrimary}
          onCheckedChange={(v) => onPrimary(v === true)}
        />
        <div className="grid gap-0.5">
          <Label htmlFor="guardian-primary">Primary contact</Label>
          <p className="text-xs text-muted-foreground">
            A student has one. Naming a new one steps the current primary down — you do not have
            to un-tick them first.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="guardian-pickup"
          checked={canPickup}
          onCheckedChange={(v) => onPickup(v === true)}
        />
        <div className="grid gap-0.5">
          <Label htmlFor="guardian-pickup">May collect this student</Label>
          <p className="text-xs text-muted-foreground">
            Shown at the gate. Leave it off for a contact who should be telephoned but not handed
            a child.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Adding a new guardian, or editing one this student already has. */
export function GuardianFormDialog({
  studentId,
  studentName,
  draft,
  relationships,
  open,
  onOpenChange,
}: {
  studentId: string;
  studentName: string;
  draft: GuardianDraft | null;
  relationships: { value: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isEdit = !!draft;

  const form = useForm<GuardianInput>({
    resolver: zodResolver(guardianSchema),
    defaultValues: draft ?? EMPTY,
  });

  // The card keeps one dialog and swaps what it is editing, so the fields have
  // to follow the row rather than the mount.
  useEffect(() => {
    form.reset(draft ?? EMPTY);
  }, [draft, form]);

  async function onSubmit(values: GuardianInput) {
    const result = isEdit
      ? await updateGuardian(studentId, draft.guardianId, values)
      : await addGuardian(studentId, values);

    if (!result.ok) {
      toast.error(result.error);
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(field as keyof GuardianInput, { message: messages?.[0] });
      }
      return;
    }

    toast.success(
      isEdit ? "Guardian updated." : `${values.firstName} is now a guardian of ${studentName}.`,
    );
    onOpenChange(false);
    form.reset(EMPTY);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit guardian" : "Add a guardian"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "This person's details are shared by every child of theirs in the school — a change here reaches all of them."
              : `Who to contact about ${studentName}, and who may collect them.`}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="firstName" label="First name" required />
              <TextField control={form.control} name="lastName" label="Last name" />
              <TextField control={form.control} name="phone" label="Phone" type="tel" />
              <TextField control={form.control} name="email" label="Email" type="email" />
              <TextField control={form.control} name="occupation" label="Occupation" />
              <SelectField
                control={form.control}
                name="relationship"
                label="Relationship"
                required
                options={relationships}
              />
              <TextField
                control={form.control}
                name="addressLine1"
                label="Address"
                className="sm:col-span-2"
              />
              <TextField control={form.control} name="city" label="City" />
              <TextField control={form.control} name="state" label="State" />
            </div>

            <LinkFlags
              isPrimary={form.watch("isPrimary")}
              canPickup={form.watch("canPickup")}
              onPrimary={(v) => form.setValue("isPrimary", v, { shouldDirty: true })}
              onPickup={(v) => form.setValue("canPickup", v, { shouldDirty: true })}
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {isEdit ? "Save changes" : "Add guardian"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Linking a guardian who is already in the school — which is what a sibling is.
 *
 * Rule 5 names sibling linking as one of the four things the identity model
 * exists to keep representable. Making a second `people` row for the same
 * mother would split her telephone number in two and leave one of them stale,
 * so the answer is a second row in `guardian_student` and nothing else.
 */
export function LinkGuardianDialog({
  studentId,
  studentName,
  relationships,
  open,
  onOpenChange,
}: {
  studentId: string;
  studentName: string;
  relationships: { value: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuardianSearchResult[] | null>(null);
  const [chosen, setChosen] = useState<GuardianSearchResult | null>(null);
  const [relationship, setRelationship] = useState("guardian");
  const [isPrimary, setIsPrimary] = useState(false);
  const [canPickup, setCanPickup] = useState(true);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    // Debounced, because every keystroke is a round trip otherwise. 250 ms is
    // below the threshold at which a person notices waiting and above the one
    // at which typing a name is twelve queries.
    const timer = setTimeout(() => {
      startSearch(async () => setResults(await searchGuardians(term)));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function save() {
    if (!chosen) return;
    startSave(async () => {
      const result = await linkGuardian(studentId, {
        guardianId: chosen.id,
        relationship,
        isPrimary,
        canPickup,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${chosen.fullName} is now a guardian of ${studentName}.`);
      onOpenChange(false);
      setQuery("");
      setChosen(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link an existing guardian</DialogTitle>
          <DialogDescription>
            For a sibling, or a parent already here for another child. One person, one record —
            their telephone number stays in one place.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="guardian-search">Search by name or telephone number</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="guardian-search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setChosen(null);
                }}
                placeholder="At least two characters"
                className="ps-9"
                autoComplete="off"
              />
            </div>
          </div>

          <div aria-live="polite" className="min-h-10">
            {searching && (
              <p className="text-sm text-muted-foreground">
                <Loader2 className="me-1 inline size-3.5 animate-spin" aria-hidden="true" />
                Searching…
              </p>
            )}
            {!searching && results?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nobody here matches “{query.trim()}”. Add them as a new guardian instead.
              </p>
            )}
            {!searching && results && results.length > 0 && (
              <ul className="grid max-h-56 gap-1 overflow-y-auto">
                {results.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setChosen(g)}
                      aria-pressed={chosen?.id === g.id}
                      className={`w-full rounded-md border p-2 text-start text-sm ${
                        chosen?.id === g.id ? "border-primary bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      <span className="font-medium break-words">{g.fullName}</span>
                      {/* Three guardians in the demo college share a name, so
                          the number and the child count are not decoration. */}
                      <span className="block text-xs text-muted-foreground">
                        {[
                          g.phone,
                          g.occupation,
                          g.children === 1 ? "1 child here" : `${g.children} children here`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {chosen && (
            <div className="grid gap-3 border-t pt-4">
              <div className="grid gap-1.5">
                <Label htmlFor="link-relationship">Relationship to {studentName}</Label>
                <select
                  id="link-relationship"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {relationships.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <LinkFlags
                isPrimary={isPrimary}
                canPickup={canPickup}
                onPrimary={setIsPrimary}
                onPickup={setCanPickup}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!chosen || saving}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Link guardian
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
