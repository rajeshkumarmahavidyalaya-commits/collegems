"use client";

import { useEffect } from "react";

/**
 * Warns before the browser tab closes/reloads with unsaved form changes.
 * Does not intercept in-app Link navigation (Next.js App Router has no
 * public router-level navigation-block API yet) -- pair this with an
 * explicit confirm step in any Cancel/Back button instead.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
