"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * A designed error state rather than Next.js' default, because "the inbox could
 * not load" and "you have no messages" must never look the same — the second is
 * fine and the first needs a retry.
 */
export default function NotificationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <span className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium">Your notifications could not be loaded</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Nothing has been lost — this is a problem reading them, not a problem with the
            messages themselves.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-muted-foreground">Reference {error.digest}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
