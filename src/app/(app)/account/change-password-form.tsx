"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD } from "@/lib/validations/password";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await changePassword({ current, password, confirm });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCurrent("");
      setPassword("");
      setConfirm("");
      toast.success("Your password has been changed.");
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4" noValidate>
      <div aria-live="polite">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-current">Current password</Label>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-new">New password</Label>
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="pw-new-hint"
        />
        <p id="pw-new-hint" className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD} characters.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-confirm">Type it again</Label>
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending || !current || !password} className="self-start">
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Change password
      </Button>
    </form>
  );
}
