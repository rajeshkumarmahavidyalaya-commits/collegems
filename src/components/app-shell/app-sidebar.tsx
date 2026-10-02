"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, GraduationCap, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NavGroup } from "./nav-config";
import { activeDestination } from "./navigation-state";
import { useI18n, useT } from "@/components/providers/i18n-provider";

function NavLink({
  href,
  icon: Icon,
  title,
  collapsed,
  active,
}: {
  href: string;
  icon: NavGroup["items"][number]["icon"];
  title: string;
  collapsed: boolean;
  active: boolean;
}) {
  const { direction } = useI18n();
  const link = (
    <Link
      href={href}
      className={cn(
        "reference-nav-link flex items-center gap-3 px-3 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
      aria-current={active ? "page" : undefined}
    >
      {/* The reference lists a module's screens by name; the icon is kept for
          the collapsed rail, where there is no name. */}
      <Icon className={cn("size-4 shrink-0", !collapsed && "hidden")} aria-hidden="true" />
      {!collapsed && <span className="truncate">{title}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side={direction === "rtl" ? "left" : "right"}>{title}</TooltipContent>
    </Tooltip>
  );
}

/** Where the open/closed state of each menu group is remembered. */
const OPEN_KEY = "schoolos:nav-open";
/** A short menu reads fine fully open; a long one opens only where you are. */
const OPEN_ALL_UP_TO = 20;

function defaultOpen(groups: NavGroup[], selected: string | null): Record<string, boolean> {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const open: Record<string, boolean> = {};
  groups.forEach((g, i) => {
    open[g.title] = total <= OPEN_ALL_UP_TO || i === 0 || g.items.some((item) => item.href === selected);
  });
  return open;
}

export function SidebarContent({
  navGroups,
  collapsed = false,
  tenantName,
  onNavigate,
}: {
  navGroups: NavGroup[];
  collapsed?: boolean;
  tenantName: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const t = useT();
  // The reference groups every screen under its module, so there is no
  // separate "Setup" fold here; once-a-year screens sit in their module.
  const selected = activeDestination(
    pathname,
    search,
    navGroups.flatMap((g) => g.items.map((item) => item.href)),
  );
  const [open, setOpen] = useState<Record<string, boolean>>(() => defaultOpen(navGroups, selected));

  // What somebody chose last time wins over the default; storage can be
  // missing or blocked, and then the default simply stands.
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
      if (stored && typeof stored === "object") setOpen((prev) => ({ ...prev, ...stored }));
    } catch {
      // Keep the default.
    }
  }, []);

  // Wherever you are is always open, however it was left.
  useEffect(() => {
    setOpen((prev) => {
      const next = { ...prev };
      for (const g of navGroups) if (g.items.some((item) => item.href === selected)) next[g.title] = true;
      return next;
    });
    // `navGroups` is rebuilt every render from the same role; the selection is
    // what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered; still toggled.
      }
      return next;
    });
  }

  const link = (item: NavGroup["items"][number]) => (
    <NavLink
      key={item.href}
      href={item.href}
      icon={item.icon}
      title={item.messageKey ? t(item.messageKey) : item.title}
      collapsed={collapsed}
      active={selected === item.href}
    />
  );

  const section = (group: NavGroup) => {
    const key = group.title;
    // The English title is the fallback, so a nav entry added before its
    // translation still reads as something.
    const label = group.messageKey ? t(group.messageKey) : group.title;
    const isOpen = open[key] ?? false;
    const holdsSelection = group.items.some((item) => item.href === selected);
    const GroupIcon = group.icon ?? GraduationCap;
    const id = `nav-${key.replace(/\W+/g, "-").toLowerCase()}`;
    return (
      <div key={key} className="reference-nav-group">
        <button
          type="button"
          onClick={(e) => {
            // The nav's own onClick closes the mobile drawer; a group header
            // is not a navigation.
            e.stopPropagation();
            toggle(key);
          }}
          aria-expanded={isOpen}
          aria-controls={id}
          className={cn(
            "reference-nav-heading flex w-full items-center justify-between px-3 py-3 text-sm hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
            holdsSelection && "reference-nav-heading-active",
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <GroupIcon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </span>
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", !isOpen && "-rotate-90 rtl:rotate-90")}
            aria-hidden="true"
          />
        </button>
        <div id={id} hidden={!isOpen} className="reference-nav-children flex flex-col">
          {group.items.map(link)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar text-sidebar-foreground">
      <div className={cn("flex min-h-12 items-center gap-2 border-b border-sidebar-border px-3 py-3", collapsed && "justify-center px-0")}>
        <GraduationCap className="size-5 shrink-0 text-sidebar-primary" aria-hidden="true" />
        {!collapsed && <span className="truncate font-semibold">{tenantName || "SchoolOS"}</span>}
      </div>

      {/* A named landmark. Two navigations exist — this and the mobile
          drawer — and an unnamed one is announced as just "navigation", which
          is no help when there are two of them. */}
      <nav
        aria-label={t("app.navigation")}
        className="flex-1 overflow-y-auto"
        onClick={onNavigate}
      >
        {collapsed ? (
          // Icons only: no headings to fold, so everything is listed.
          <div className="flex flex-col gap-0.5 py-2">{navGroups.flatMap((g) => g.items).map(link)}</div>
        ) : (
          navGroups.map(section)
        )}
      </nav>
    </div>
  );
}

export function DesktopSidebar({
  navGroups,
  tenantName,
  collapsed,
  onToggleCollapsed,
}: {
  navGroups: NavGroup[];
  tenantName: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const t = useT();

  return (
    <aside
      data-print="hide"
      className={cn(
        "reference-sidebar sticky top-9 hidden h-[calc(100svh-2.25rem)] shrink-0 border-e border-sidebar-border transition-[width] duration-200 lg:flex lg:flex-col",
        collapsed ? "w-14" : "w-[220px]",
      )}
    >
      <div className="relative min-h-0 flex-1">
        <SidebarContent navGroups={navGroups} collapsed={collapsed} tenantName={tenantName} />
      </div>
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t("app.sidebar.expand") : t("app.sidebar.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span className="text-xs">{t("app.sidebar.collapseLabel")}</span>}
        </Button>
      </div>
    </aside>
  );
}
