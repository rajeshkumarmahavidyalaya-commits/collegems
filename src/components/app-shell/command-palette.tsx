"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, LayoutDashboard, Loader2, User, Users } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { globalSearch, type SearchResult } from "@/app/actions/search";
import { NAV_GROUPS } from "./nav-config";

const TYPE_ICON: Record<SearchResult["type"], typeof User> = {
  student: User,
  staff: Users,
  book: BookOpen,
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
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
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search SchoolOS"
      description="Search students, staff, and books, or jump to a page"
    >
      <CommandInput
        placeholder="Search students, staff, books…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isPending && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        {!isPending && <CommandEmpty>No results found.</CommandEmpty>}

        {results.length > 0 && (
          <CommandGroup heading="Results">
            {results.map((r) => {
              const Icon = TYPE_ICON[r.type];
              return (
                <CommandItem key={`${r.type}-${r.id}`} onSelect={() => go(r.href)}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <div className="flex flex-col">
                    <span>{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.subtitle}</span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/")}>
            <LayoutDashboard className="size-4 text-muted-foreground" aria-hidden="true" />
            Dashboard
          </CommandItem>
          {NAV_GROUPS.flatMap((g) => g.items)
            .filter((item) => item.href !== "/")
            .map((item) => (
              <CommandItem key={item.href} onSelect={() => go(item.href)}>
                <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {item.title}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
