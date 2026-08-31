"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, GraduationCap, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginActionState } from "./actions";

const initialState: LoginActionState = { error: null };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const emailId = useId();
  const passwordId = useId();

  useEffect(() => {
    if (state.error) {
      errorSummaryRef.current?.focus();
    }
  }, [state.error]);

  const emailErrors = state.fieldErrors?.email;
  const passwordErrors = state.fieldErrors?.password;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />

      {state.error && (
        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={emailId}>Email address</Label>
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
        <div className="flex items-center justify-between">
          <Label htmlFor={passwordId}>Password</Label>
        </div>
        <div className="relative">
          <Input
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={!!passwordErrors}
            aria-describedby={passwordErrors ? `${passwordId}-error` : undefined}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {passwordErrors && (
          <p id={`${passwordId}-error`} className="text-sm text-destructive">
            {passwordErrors[0]}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isPending} className="mt-1">
        {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Sign in
      </Button>
    </form>
  );
}

export function LoginBranding() {
  return (
    <div className="flex h-full flex-col justify-between bg-primary p-10 text-primary-foreground">
      <div className="flex items-center gap-2 font-semibold">
        <GraduationCap className="size-6" aria-hidden="true" />
        SchoolOS
      </div>
      <div className="max-w-sm">
        <p className="text-lg font-medium text-balance">
          One system for admissions, attendance, fees, and everything else that keeps a school running.
        </p>
        <p className="mt-3 text-sm text-primary-foreground/80">
          Built for the people who run the school, not just the people who buy the software.
        </p>
      </div>
      <p className="text-xs text-primary-foreground/60">© {new Date().getFullYear()} SchoolOS</p>
    </div>
  );
}
