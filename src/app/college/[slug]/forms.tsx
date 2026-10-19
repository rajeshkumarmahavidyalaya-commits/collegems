"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/en";
import { ADMISSION_GENDERS, HONEYPOT_FIELD } from "@/lib/validations/admissions-display";
import { PUBLIC_LIMITS } from "@/lib/validations/public-pages";
import { sendEnquiry, sendStaffApplication, type PublicFormState } from "./actions";

/** The look of `Input`, for a native `<select>` that submits with the form. */
export const selectClass =
  "border-input bg-transparent h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive md:text-sm dark:bg-input/30";

type FieldSpec = {
  name: string;
  label: MessageKey;
  kind?: "text" | "tel" | "email" | "date" | "textarea" | "select";
  required?: boolean;
  max?: number;
  hint?: MessageKey;
  options?: { value: string; label: string }[];
  emptyOption?: MessageKey;
  wide?: boolean;
};

type Kind = "enquiry" | "jobs";

/**
 * The two public application forms: an admission enquiry and a staff
 * application. A remount per submission, as on `/apply`, so "send another" is a
 * fresh form rather than one still holding the first person's details.
 */
export function PublicApplicationForm(props: {
  kind: Kind;
  slug: string;
  college: string;
  classLevels: { id: string; name: string }[];
}) {
  const [round, setRound] = useState(0);
  return <OneForm key={round} {...props} onAnother={() => setRound((r) => r + 1)} />;
}

const initial: PublicFormState = {};

function OneForm({
  kind,
  slug,
  college,
  classLevels,
  onAnother,
}: {
  kind: Kind;
  slug: string;
  college: string;
  classLevels: { id: string; name: string }[];
  onAnother: () => void;
}) {
  const { t } = useI18n();
  const action = kind === "enquiry" ? sendEnquiry : sendStaffApplication;
  const [state, formAction, isPending] = useActionState(action.bind(null, slug), initial);
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.errorKey || state.error || state.done) summaryRef.current?.focus();
  }, [state]);

  const fields: FieldSpec[] =
    kind === "enquiry"
      ? [
          { name: "student_name", label: "public.enquiry.studentName", required: true, max: PUBLIC_LIMITS.studentName },
          ...(classLevels.length > 0
            ? [
                {
                  name: "class_level_id",
                  label: "apply.classLevel",
                  kind: "select",
                  options: classLevels.map((c) => ({ value: c.id, label: c.name })),
                  emptyOption: "apply.classLevel.none",
                } satisfies FieldSpec,
              ]
            : []),
          { name: "contact_name", label: "apply.contactName", required: true, max: PUBLIC_LIMITS.contactName },
          { name: "phone", label: "apply.phone", kind: "tel", max: PUBLIC_LIMITS.phone, hint: "apply.contactHint" },
          { name: "email", label: "apply.email", kind: "email", max: PUBLIC_LIMITS.email },
          { name: "message", label: "public.enquiry.message", kind: "textarea", max: PUBLIC_LIMITS.enquiryMessage, wide: true },
        ]
      : [
          { name: "first_name", label: "apply.firstName", required: true, max: PUBLIC_LIMITS.name },
          { name: "last_name", label: "apply.lastName", max: PUBLIC_LIMITS.name },
          { name: "position", label: "public.jobs.position", required: true, max: PUBLIC_LIMITS.position },
          { name: "qualification", label: "public.jobs.qualification", max: PUBLIC_LIMITS.qualification },
          { name: "experience_years", label: "public.jobs.experience", max: 4 },
          { name: "date_of_birth", label: "apply.dateOfBirth", kind: "date" },
          {
            name: "gender",
            label: "apply.gender",
            kind: "select",
            options: ADMISSION_GENDERS.map((g) => ({ value: g, label: t(`apply.gender.${g}` as MessageKey) })),
            emptyOption: "apply.gender.choose",
          },
          { name: "city", label: "public.jobs.city", max: PUBLIC_LIMITS.city },
          { name: "phone", label: "apply.phone", kind: "tel", max: PUBLIC_LIMITS.phone, hint: "apply.contactHint" },
          { name: "email", label: "apply.email", kind: "email", max: PUBLIC_LIMITS.email },
          { name: "message", label: "public.jobs.message", kind: "textarea", max: PUBLIC_LIMITS.jobMessage, wide: true },
        ];

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
          {t(kind === "enquiry" ? "public.enquiry.done.title" : "public.jobs.done.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(kind === "enquiry" ? "public.enquiry.done.body" : "public.jobs.done.body", { college })}
        </p>
        {state.done.reference ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("public.done.reference")}</span>
            <bdi className="font-mono text-2xl font-semibold tracking-wide text-foreground select-all">
              {state.done.reference}
            </bdi>
          </div>
        ) : null}
        {state.done.duplicate ? <p className="text-sm text-muted-foreground">{t("public.done.duplicate")}</p> : null}
        <div>
          <Button type="button" variant="outline" onClick={onAnother}>
            {t("public.done.another")}
          </Button>
        </div>
      </div>
    );
  }

  const fe = state.fieldErrors ?? {};
  const values = state.values ?? {};
  const message = state.errorKey ? t(state.errorKey as MessageKey) : state.error;

  return (
    <form key={JSON.stringify(values)} action={formAction} className="flex flex-col gap-6" noValidate>
      {message ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <span>{message}</span>
            {Object.keys(fe).length > 0 ? (
              <ul className="list-disc ps-5">
                {Object.entries(fe).map(([field, key]) => (
                  <li key={field}>
                    <a href={`#public-${field}`} className="underline underline-offset-2">
                      {t(key as MessageKey)}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The honeypot, as on /apply: off-screen, hidden from assistive
          technology and out of the tab order, so no person meets it. */}
      <div aria-hidden="true" className="absolute -start-[10000px] top-auto size-px overflow-hidden">
        <label>
          Website
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field
            key={f.name}
            spec={f}
            value={values[f.name] ?? ""}
            error={fe[f.name] ? t(fe[f.name] as MessageKey) : undefined}
            optional={f.required ? undefined : t("apply.optional")}
            hint={f.hint ? t(f.hint) : undefined}
            label={t(f.label)}
            emptyOption={f.emptyOption ? t(f.emptyOption) : ""}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("apply.privacy", { college })}</p>
        <div>
          <Button type="submit" disabled={isPending} aria-disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("apply.submitting")}
              </>
            ) : (
              t(kind === "enquiry" ? "public.enquiry.submit" : "public.jobs.submit")
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({
  spec,
  value,
  error,
  hint,
  optional,
  label,
  emptyOption,
}: {
  spec: FieldSpec;
  value: string;
  error?: string;
  hint?: string;
  optional?: string;
  label: string;
  emptyOption: string;
}) {
  const id = `public-${spec.name}`;
  const described = useId();
  const describedBy = error ? `${described}-error` : hint ? `${described}-hint` : undefined;
  const common = {
    id,
    name: spec.name,
    defaultValue: value,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
    "aria-required": spec.required || undefined,
  };
  const kind = spec.kind ?? "text";

  return (
    <div className={`grid content-start gap-2 ${spec.wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ms-1 font-normal text-muted-foreground">({optional})</span> : null}
        {spec.required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {kind === "textarea" ? (
        <Textarea {...common} rows={4} maxLength={spec.max} />
      ) : kind === "select" ? (
        <select {...common} className={selectClass}>
          <option value="">{emptyOption}</option>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          {...common}
          type={kind}
          maxLength={spec.max}
          // A number and an address are left-to-right in every language.
          dir={kind === "tel" || kind === "email" ? "ltr" : undefined}
          inputMode={kind === "tel" ? "tel" : spec.name === "experience_years" ? "decimal" : undefined}
          autoComplete={kind === "tel" ? "tel" : kind === "email" ? "email" : "off"}
        />
      )}
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
