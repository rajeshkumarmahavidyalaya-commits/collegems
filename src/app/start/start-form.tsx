"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkSlug, startSchool, type StartActionState } from "./actions";
import { SLUG_PATTERN, slugify } from "@/lib/validations/platform";

const initialState: StartActionState = { error: null };

type SlugState = "idle" | "checking" | "free" | "taken";

export function StartForm({ timezones }: { timezones: string[] }) {
  const [state, formAction, isPending] = useActionState(startSchool, initialState);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // Whether the person has taken the address into their own hands. Until they
  // do, it follows the name; after, it never fights them for it.
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>("idle");
  const [, startCheck] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);

  const nameId = useId();
  const slugId = useId();
  const tzId = useId();

  useEffect(() => {
    if (state.error) summaryRef.current?.focus();
  }, [state.error]);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  useEffect(() => {
    if (!SLUG_PATTERN.test(effectiveSlug)) {
      setSlugState("idle");
      return;
    }
    setSlugState("checking");
    // Debounced: a keystroke is not a question worth asking the server.
    const timer = setTimeout(() => {
      startCheck(async () => {
        const free = await checkSlug(effectiveSlug);
        setSlugState(free ? "free" : "taken");
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [effectiveSlug]);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={nameId}>School name</Label>
        <Input
          id={nameId}
          name="schoolName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          placeholder="St Aloysius High School"
          aria-invalid={!!state.fieldErrors?.schoolName}
        />
        {state.fieldErrors?.schoolName && (
          <p className="text-sm text-destructive">{state.fieldErrors.schoolName[0]}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={slugId}>Web address</Label>
        <div className="flex items-center gap-2">
          <Input
            id={slugId}
            name="slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            required
            className="font-mono"
            aria-invalid={slugState === "taken" || !!state.fieldErrors?.slug}
            aria-describedby={`${slugId}-status`}
          />
          <span className="shrink-0 text-sm text-muted-foreground" aria-hidden="true">
            .schoolos.app
          </span>
        </div>
        {/* Three states, and none of them may be shown as another: a blank
            field is not "taken", and "checking" is not "free". */}
        <p id={`${slugId}-status`} className="flex items-center gap-1.5 text-xs" aria-live="polite">
          {slugState === "checking" && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Checking…
            </span>
          )}
          {slugState === "free" && (
            <span className="flex items-center gap-1.5 text-primary">
              <Check className="size-3" aria-hidden="true" /> {effectiveSlug}.schoolos.app is free
            </span>
          )}
          {slugState === "taken" && (
            <span className="flex items-center gap-1.5 text-destructive">
              <X className="size-3" aria-hidden="true" /> That address is taken
            </span>
          )}
          {slugState === "idle" && (
            <span className="text-muted-foreground">
              Lower-case letters, numbers and hyphens. This is permanent.
            </span>
          )}
        </p>
        {state.fieldErrors?.slug && (
          <p className="text-sm text-destructive">{state.fieldErrors.slug[0]}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={tzId}>Time zone</Label>
        <select
          id={tzId}
          name="timezone"
          defaultValue="Asia/Kolkata"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {/* Not decoration. Rule 7's scheduler asks each tenant "is it half past
            seven where you are?", and every register, receipt and absence
            notice is dated against this. */}
        <p className="text-xs text-muted-foreground">
          Registers, receipts and evening notices all use this clock.
        </p>
      </div>

      <Button type="submit" disabled={isPending || slugState === "taken"} className="w-full">
        {isPending && <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />}
        Create the school
      </Button>

      <p className="text-xs text-muted-foreground">
        You get thirty days of everything, up to 50 children and 10 staff. No card needed.
      </p>
    </form>
  );
}
