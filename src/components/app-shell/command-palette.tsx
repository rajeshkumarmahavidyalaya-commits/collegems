"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, User, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { globalSearch } from "@/app/actions/search";
import {
  searchHitHref,
  searchHitSubtitle,
  type SearchHit,
  type SearchKind,
} from "@/lib/validations/search-display";
import { useT } from "@/components/providers/i18n-provider";
import type { NavGroup } from "./nav-config";

const KIND_ICON: Record<SearchKind, typeof User> = {
  student: User,
  staff: Users,
  book: BookOpen,
};

/**
 * Ctrl-K, on all 94 authenticated pages.
 *
 * ## It takes the nav tree rather than reading it
 *
 * `navForRole(roleCode)` has existed since the shell was built and the sidebar
 * has always called it. This component imported `NAV_GROUPS` **raw**, so the
 * two halves of one app shell disagreed about who a menu entry is for:
 *
 * | role | sidebar | palette |
 * |---|---|---|
 * | admin | 51 | 54 |
 * | teacher | 26 | 54 |
 * | accountant | 33 | 54 |
 * | librarian | 16 | 54 |
 * | parent | 10 | 54 |
 * | student | 10 | 54 |
 *
 * A guardian pressing Ctrl-K was offered *Payroll*, *Fee counter*, *Voucher
 * book*, *Delivery log* and *What each role may do* — three of those are
 * entries `CLAUDE.md`'s rule 4 section describes taking away from exactly that
 * seat, and the guard that did it went on passing, because it reads the
 * `roles` lists and this file read the same lists without the filter.
 *
 * > **A guard on a list is not a guard on its consumers.**
 *
 * So the tree arrives as a prop, already filtered, from the one place that
 * filters it. There is no `roleCode` here and no second call to `navForRole`:
 * two callers of one filter is where the two answers came from in the first
 * place. `tests/app-shell/nav-consumers.test.ts` is the executable half.
 *
 * **None of this is a boundary** — rule 4's first sentence is that the menu is
 * never the gate, and that is as true of a palette as of a sidebar. Every page
 * behind these entries still checks its own permission, and the search results
 * are decided by RLS inside `global_search`.
 */
export function CommandPalette({ navGroups }: { navGroups: NavGroup[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        setResults(await globalSearch(query));
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")} description={t("palette.description")}>
      <CommandInput
        placeholder={t("palette.placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isPending && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        {!isPending && <CommandEmpty>{t("state.noResults")}</CommandEmpty>}

        {results.length > 0 && (
          <CommandGroup heading={t("palette.results")}>
            {results.map((hit) => {
              const Icon = KIND_ICON[hit.kind];
              const subtitle = searchHitSubtitle(hit, t);
              return (
                <CommandItem key={`${hit.kind}-${hit.id}`} onSelect={() => go(searchHitHref(hit))}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <div className="flex flex-col">
                    {/* A name and an admission number are data, and a school
                        with an Urdu interface still has Latin-script names in
                        it: `dir="auto"` lets each value declare its own run
                        rather than inheriting the page's. */}
                    <span dir="auto">{hit.title}</span>
                    {subtitle && (
                      <span dir="auto" className="text-xs text-muted-foreground">
                        {subtitle}
                      </span>
                    )}
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {navGroups.map((group) => (
          <CommandGroup
            key={group.messageKey ?? group.title}
            heading={group.messageKey ? t(group.messageKey) : group.title}
          >
            {group.items.map((item) => (
              <CommandItem key={item.href} onSelect={() => go(item.href)}>
                <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {item.messageKey ? t(item.messageKey) : item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
