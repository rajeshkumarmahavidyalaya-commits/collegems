"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, GraduationCap, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginActionState } from "./actions";
import { useT } from "@/components/providers/i18n-provider";

const initialState: LoginActionState = { error: null };

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
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
        <Label htmlFor={emailId}>{t("login.email")}</Label>
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
          <Label htmlFor={passwordId}>{t("login.password")}</Label>
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
            className="pe-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
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
        {isPending ? t("login.submitting") : t("login.submit")}
      </Button>
    </form>
  );
}

/**
 * The product name, isolated from the direction of the text around it.
 *
 * `SchoolOS` is a Latin string, and inside an RTL paragraph the bidi algorithm
 * reorders the neutral characters at its edges: `© 2026 SchoolOS` rendered as
 * `SchoolOS 2026 ©`, and a sentence ending in an English clause put its full
 * stop at the *start* of the line. `<bdi>` is the element for exactly this —
 * it isolates the run so the surrounding direction stops leaking into it.
 */
function Brand({ className }: { className?: string }) {
  return <bdi className={className}>SchoolOS</bdi>;
}

export function LoginBranding() {
  const t = useT();

  return (
    <div className="flex h-full flex-col justify-between bg-primary p-10 text-primary-foreground">
      <div className="flex items-center gap-2 font-semibold">
        <GraduationCap className="size-6" aria-hidden="true" />
        <Brand />
      </div>
      <div className="max-w-sm">
        <p className="text-lg font-medium text-balance">{t("login.brandHeadline")}</p>
        <p className="mt-3 text-sm text-primary-foreground/80">{t("login.brandSub")}</p>
      </div>
      <p className="text-xs text-primary-foreground/60">
        {t("login.copyright", { year: String(new Date().getFullYear()) })}
      </p>
    </div>
  );
}

/**
 * The same identity, for a phone.
 *
 * The branding panel is `hidden lg:block`, so on a 375px screen the whole page
 * was an unlabelled form on a plain field: no logo, no product name, nothing
 * saying what you are about to sign in to. That is the screen most parents will
 * ever see.
 */
export function LoginBrandingCompact() {
  return (
    <div className="mb-8 flex items-center gap-2 font-semibold text-foreground lg:hidden">
      <GraduationCap className="size-6 text-primary" aria-hidden="true" />
      <Brand />
    </div>
  );
}
