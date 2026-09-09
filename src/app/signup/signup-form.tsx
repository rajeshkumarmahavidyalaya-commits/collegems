"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signup, type SignupActionState } from "./actions";

const initialState: SignupActionState = { error: null, notice: null };

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signup, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const emailId = useId();
  const passwordId = useId();
  const confirmId = useId();

  useEffect(() => {
    if (state.error || state.notice) summaryRef.current?.focus();
  }, [state.error, state.notice]);

  const emailErrors = state.fieldErrors?.email;
  const passwordErrors = state.fieldErrors?.password;
  const confirmErrors = state.fieldErrors?.confirm;

  // Once the confirmation mail is out there is nothing left to type, so the
  // form is replaced rather than left sitting under a message inviting a second
  // submission.
  if (state.notice) {
    return (
      <div
        ref={summaryRef}
        tabIndex={-1}
        role="status"
        className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm outline-none"
      >
        <span className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{state.notice}</span>
        </span>
        <Button asChild variant="outline" size="sm">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

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
        <Label htmlFor={emailId}>Your email</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!emailErrors}
          aria-describedby={emailErrors ? `${emailId}-error` : undefined}
        />
        {emailErrors && (
          <p id={`${emailId}-error`} className="text-sm text-destructive">
            {emailErrors[0]}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={passwordId}>Password</Label>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            className="pe-10"
            aria-invalid={!!passwordErrors}
            aria-describedby={passwordErrors ? `${passwordId}-error` : `${passwordId}-hint`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-e-md"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {passwordErrors ? (
          <p id={`${passwordId}-error`} className="text-sm text-destructive">
            {passwordErrors[0]}
          </p>
        ) : (
          <p id={`${passwordId}-hint`} className="text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={confirmId}>Confirm password</Label>
        <Input
          id={confirmId}
          name="confirm"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          aria-invalid={!!confirmErrors}
          aria-describedby={confirmErrors ? `${confirmId}-error` : undefined}
        />
        {confirmErrors && (
          <p id={`${confirmId}-error`} className="text-sm text-destructive">
            {confirmErrors[0]}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending && <Loader2 className="me-2 size-4 animate-spin" aria-hidden="true" />}
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have one?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
