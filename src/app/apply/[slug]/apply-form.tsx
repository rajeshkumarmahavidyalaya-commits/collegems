"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ADMISSION_LIMITS, HONEYPOT_FIELD } from "@/lib/validations/admissions-display";
import { submitApplication, type ApplyState } from "./actions";

export type ApplyLabels = {
  sectionChild: string;
  sectionContact: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  genderChoose: string;
  classLevel: string;
  classLevelNone: string;
  contactName: string;
  relationship: string;
  relationshipHint: string;
  phone: string;
  email: string;
  contactHint: string;
  notes: string;
  optional: string;
  submit: string;
  submitting: string;
  privacy: string;
  doneTitle: string;
  doneBody: string;
  doneDuplicate: string;
  doneReference: string;
  doneAnother: string;
};

type Props = {
  slug: string;
  college: string;
  classLevels: { id: string; name: string }[];
  labels: ApplyLabels;
  genders: { value: string; label: string }[];
};

/**
 * A remount per application: "apply for another child" is a fresh form with a
 * fresh action state, not a form somebody has to clear by hand — and not one
 * still holding the first child's name when a parent applies for a sibling.
 */
export function ApplyForm(props: Props) {
  const [round, setRound] = useState(0);
  return <OneApplication key={round} {...props} onAnother={() => setRound((r) => r + 1)} />;
}

const initialState: ApplyState = { error: null };

/** The look of `Input`, for a native `<select>` that submits with the form. */
const selectClass =
  "border-input bg-transparent h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive md:text-sm dark:bg-input/30";

function OneApplication({
  slug,
  classLevels,
  labels,
  genders,
  onAnother,
}: Props & { onAnother: () => void }) {
  const [state, formAction, isPending] = useActionState(
    submitApplication.bind(null, slug),
    initialState,
  );
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.error || state.done) summaryRef.current?.focus();
  }, [state]);

  if (state.done) {
    return (
      <div
        ref={summaryRef}
        tabIndex={-1}
        role="status"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-6 outline-none"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
          {labels.doneTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{labels.doneBody}</p>
        {state.done.reference ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{labels.doneReference}</span>
            {/* A reference is read aloud over the phone and copied off a
                screen, so it is large and in the tabular face, and isolated so
                an RTL paragraph cannot reorder its hyphens. */}
            <bdi className="font-mono text-2xl font-semibold tracking-wide text-foreground select-all">
              {state.done.reference}
            </bdi>
          </div>
        ) : null}
        {state.done.duplicate ? (
          <p className="text-sm text-muted-foreground">{labels.doneDuplicate}</p>
        ) : null}
        <div>
          <Button type="button" variant="outline" onClick={onAnother}>
            {labels.doneAnother}
          </Button>
        </div>
      </div>
    );
  }

  const fe = state.fieldErrors ?? {};
  const values = state.values ?? {};

  return (
    // Keyed on what came back, so a refusal remounts the fields with the
    // applicant's own words in them rather than React's reset to empty.
    <form key={JSON.stringify(values)} action={formAction} className="flex flex-col gap-8" noValidate>
      {state.error ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <span>{state.error}</span>
            {Object.keys(fe).length > 0 ? (
              <ul className="list-disc ps-5">
                {Object.entries(fe).map(([field, message]) => (
                  <li key={field}>
                    <a href={`#apply-${field}`} className="underline underline-offset-2">
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The honeypot: see `admissions-display.ts`. Off-screen rather than
          `display: none`, which the cheapest scripts skip; hidden from
          assistive technology and out of the tab order, so no person meets it. */}
      <div aria-hidden="true" className="absolute -start-[10000px] top-auto size-px overflow-hidden">
        <label>
          Website
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-base font-semibold text-foreground">{labels.sectionChild}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field values={values} name="firstName" label={labels.firstName} error={fe.firstName} required>
            {(p) => <Input {...p} autoComplete="off" maxLength={ADMISSION_LIMITS.name} />}
          </Field>
          <Field values={values} name="lastName" label={labels.lastName} error={fe.lastName} optional={labels.optional}>
            {(p) => <Input {...p} autoComplete="off" maxLength={ADMISSION_LIMITS.name} />}
          </Field>
          <Field values={values} name="dateOfBirth" label={labels.dateOfBirth} error={fe.dateOfBirth} optional={labels.optional}>
            {(p) => <Input {...p} type="date" />}
          </Field>
          <Field values={values} name="gender" label={labels.gender} error={fe.gender} optional={labels.optional}>
            {(p) => (
              <select {...p} className={selectClass}>
                <option value="">{labels.genderChoose}</option>
                {genders.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {classLevels.length > 0 ? (
            <Field
              values={values}
              name="classLevelId"
              label={labels.classLevel}
              error={fe.classLevelId}
              optional={labels.optional}
            >
              {(p) => (
                <select {...p} className={selectClass}>
                  <option value="">{labels.classLevelNone}</option>
                  {classLevels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-base font-semibold text-foreground">{labels.sectionContact}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field values={values} name="contactName" label={labels.contactName} error={fe.contactName} required>
            {(p) => <Input {...p} autoComplete="name" maxLength={ADMISSION_LIMITS.contactName} />}
          </Field>
          <Field
            values={values}
            name="relationship"
            label={labels.relationship}
            error={fe.relationship}
            optional={labels.optional}
            hint={labels.relationshipHint}
          >
            {(p) => <Input {...p} autoComplete="off" maxLength={ADMISSION_LIMITS.relationship} />}
          </Field>
          <Field values={values} name="contactPhone" label={labels.phone} error={fe.contactPhone} hint={labels.contactHint}>
            {/* A number and an address are left-to-right in every language: in an
                RTL field the + and the punctuation would reorder as typed. */}
            {(p) => <Input {...p} type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={20} />}
          </Field>
          <Field values={values} name="contactEmail" label={labels.email} error={fe.contactEmail}>
            {(p) => <Input {...p} type="email" dir="ltr" autoComplete="email" maxLength={ADMISSION_LIMITS.email} />}
          </Field>
        </div>
        <Field values={values} name="notes" label={labels.notes} error={fe.notes} optional={labels.optional}>
          {(p) => <Textarea {...p} rows={4} maxLength={ADMISSION_LIMITS.notes} />}
        </Field>
      </fieldset>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{labels.privacy}</p>
        <div>
          <Button type="submit" disabled={isPending} aria-disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {labels.submitting}
              </>
            ) : (
              labels.submit
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  name: string;
  defaultValue: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
};

/**
 * One labelled control with its hint and its error, wired for a screen reader:
 * the error replaces the hint in `aria-describedby`, so the message read out is
 * the one on the screen. The id is `apply-<name>` so the error summary above
 * can link to it.
 */
function Field({
  name,
  label,
  error,
  hint,
  required,
  optional,
  values,
  children,
}: {
  values: Record<string, string>;
  name: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  optional?: string;
  children: (props: FieldProps) => React.ReactNode;
}) {
  const id = `apply-${name}`;
  const described = useId();
  const describedBy = error ? `${described}-error` : hint ? `${described}-hint` : undefined;

  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ms-1 font-normal text-muted-foreground">({optional})</span> : null}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children({
        id,
        name,
        defaultValue: values[name] ?? "",
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })}
      {error ? (
        <p id={`${described}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${described}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
