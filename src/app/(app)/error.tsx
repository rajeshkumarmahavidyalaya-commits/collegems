"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/components/providers/i18n-provider";

/**
 * The error boundary for the other eighty-seven routes.
 *
 * `/notifications` has had one since the inbox shipped, and it was the only one
 * in the app — so a failed query on any other screen unwound past the group and
 * rendered Next's default: no shell, no sidebar, no retry, and the person's
 * place in the product gone.
 *
 * A nested boundary wins, so `/notifications/error.tsx` still handles the inbox
 * with its own wording. This is the floor beneath everything else, and a route
 * whose failure deserves a specific sentence should add its own file exactly
 * the way the inbox did.
 *
 * `aria-live="assertive"` because the person did not ask for this text: it
 * replaces content they were waiting for, and a screen-reader user who hears
 * nothing is left listening to a page that never arrives.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardContent
        className="flex flex-col items-center gap-4 py-16 text-center"
        role="alert"
        aria-live="assertive"
      >
        <span className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">{t("boundary.error.title")}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{t("boundary.error.body")}</p>
          {/* The digest is the only thing that connects what somebody saw to a
              line in the server log. Rendering it is the difference between a
              support conversation and a guess. */}
          {error.digest && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {t("boundary.error.reference", { digest: error.digest })}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          {t("boundary.error.retry")}
        </Button>
      </CardContent>
    </Card>
  );
}
