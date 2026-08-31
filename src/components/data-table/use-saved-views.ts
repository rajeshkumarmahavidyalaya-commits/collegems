"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColumnFiltersState, SortingState, VisibilityState } from "@tanstack/react-table";

export type SavedViewState = {
  sorting: SortingState;
  columnVisibility: VisibilityState;
  columnFilters: ColumnFiltersState;
};

export type SavedView = {
  name: string;
  state: SavedViewState;
};

/**
 * Per-viewer, per-table saved views (sort/filter/column-visibility presets).
 * Stored in localStorage -- not synced across devices. Good enough for the
 * "save my usual filter" convenience this is meant for; nothing here should
 * hold data that must survive a cleared browser or be shared between users.
 */
export function useSavedViews(key: string) {
  const storageKey = `schoolos:views:${key}`;
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      setViews(raw ? JSON.parse(raw) : []);
    } catch {
      setViews([]);
    }
  }, [storageKey, key]);

  const persist = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Private browsing / storage disabled -- view just won't persist.
      }
    },
    [storageKey],
  );

  const save = useCallback(
    (name: string, state: SavedViewState) => {
      persist([...views.filter((v) => v.name !== name), { name, state }]);
    },
    [views, persist],
  );

  const remove = useCallback(
    (name: string) => {
      persist(views.filter((v) => v.name !== name));
    },
    [views, persist],
  );

  return { views, save, remove };
}
