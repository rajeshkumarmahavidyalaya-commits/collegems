"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import type { FieldErrors, FieldValues } from "react-hook-form";

function flattenMessages(errors: FieldErrors, prefix = ""): { id: string; message: string }[] {
  const out: { id: string; message: string }[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (!value) continue;
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && "message" in value && typeof value.message === "string") {
      out.push({ id, message: value.message });
    } else if (typeof value === "object") {
      out.push(...flattenMessages(value as FieldErrors, id));
    }
  }
  return out;
}

/**
 * Focusable error summary shown after a failed submit, per the project's
 * accessibility rules: complements (never replaces) inline field errors,
 * links each item to its field, and moves focus to itself so keyboard/
 * screen-reader users land somewhere useful.
 */
export function ErrorSummary<TFieldValues extends FieldValues>({
  errors,
  submitCount,
}: {
  errors: FieldErrors<TFieldValues>;
  submitCount: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const messages = flattenMessages(errors);

  useEffect(() => {
    if (submitCount > 0 && messages.length > 0) {
      ref.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitCount]);

  if (messages.length === 0) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby="form-error-summary-title"
      className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 outline-none"
    >
      <div className="flex items-center gap-2 font-medium text-destructive">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <span id="form-error-summary-title">There is a problem</span>
      </div>
      <ul className="mt-2 ml-6 list-disc space-y-1 text-sm text-destructive">
        {messages.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2 hover:no-underline"
              onClick={() => {
                const el = document.getElementsByName(m.id)[0] as HTMLElement | undefined;
                el?.focus();
                el?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
            >
              {m.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
