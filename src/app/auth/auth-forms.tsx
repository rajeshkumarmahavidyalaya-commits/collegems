"use client";

import { useActionState, useId } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/providers/i18n-provider";
import { MIN_PASSWORD } from "@/lib/validations/password";
import { requestPasswordReset, resetPassword, type AuthFormState } from "./actions";

const initial: AuthFormState = { error: null };

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function ForgotForm() {
  const t = useT();
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  const emailId = useId();

  if (state.sent) {
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <div className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{t("auth.forgot.sent")}</span>
        </div>
        <Link href="/login" className="text-sm underline underline-offset-4">
          {t("auth.forgot.back")}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <ErrorBox message={state.error} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>{t("login.email")}</Label>
        <Input id={emailId} name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {t("auth.forgot.submit")}
      </Button>
      <Link href="/login" className="text-sm underline underline-offset-4">
        {t("auth.forgot.back")}
      </Link>
    </form>
  );
}

export function ResetForm() {
  const t = useT();
  const [state, action, pending] = useActionState(resetPassword, initial);
  const passwordId = useId();
  const confirmId = useId();

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <ErrorBox message={state.error} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>{t("auth.reset.newPassword")}</Label>
        <Input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={confirmId}>{t("auth.reset.confirm")}</Label>
        <Input id={confirmId} name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {t("auth.reset.submit")}
      </Button>
    </form>
  );
}
