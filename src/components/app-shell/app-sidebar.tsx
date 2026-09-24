"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, GraduationCap, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { splitSetup, type NavGroup } from "./nav-config";
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
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
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
const SETUP = "__setup__";

/** A short menu reads fine fully open; a long one opens only where you are. */
const OPEN_ALL_UP_TO = 20;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function defaultOpen(daily: NavGroup[], setup: NavGroup["items"], pathname: string): Record<string, boolean> {
  const total = daily.reduce((n, g) => n + g.items.length, 0);
  const open: Record<string, boolean> = {};
  daily.forEach((g, i) => {
    open[g.title] = total <= OPEN_ALL_UP_TO || i === 0 || g.items.some((item) => isActive(pathname, item.href));
  });
  open[SETUP] = setup.some((item) => isActive(pathname, item.href));
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
  const t = useT();
  const { daily, setup } = splitSetup(navGroups);
  const [open, setOpen] = useState<Record<string, boolean>>(() => defaultOpen(daily, setup, pathname));

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
      for (const g of daily) if (g.items.some((item) => isActive(pathname, item.href))) next[g.title] = true;
      if (setup.some((item) => isActive(pathname, item.href))) next[SETUP] = true;
      return next;
    });
    // `daily` and `setup` are rebuilt every render from the same props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
      active={isActive(pathname, item.href)}
    />
  );

  const section = (key: string, label: string, items: NavGroup["items"], hint?: string) => {
    const isOpen = open[key] ?? false;
    const id = `nav-${key.replace(/\W+/g, "-").toLowerCase()}`;
    return (
      <div key={key} className="mb-2">
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
          className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="truncate">{label}</span>
          <span className="flex items-center gap-1.5 normal-case">
            {!isOpen && <span className="text-[11px] tabular-nums">{items.length}</span>}
            <ChevronDown
              className={cn("size-3.5 shrink-0 transition-transform", !isOpen && "-rotate-90 rtl:rotate-90")}
              aria-hidden="true"
            />
          </span>
        </button>
        <div id={id} hidden={!isOpen} className="mt-0.5 flex flex-col gap-0.5">
          {hint && <p className="px-3 pb-1 text-[11px] text-sidebar-foreground/50">{hint}</p>}
          {items.map(link)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-14 items-center gap-2 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <GraduationCap className="size-5 shrink-0 text-sidebar-primary" aria-hidden="true" />
        {!collapsed && <span className="truncate font-semibold">{tenantName || "SchoolOS"}</span>}
      </div>

      {/* A named landmark. Two navigations exist — this and the mobile
          drawer — and an unnamed one is announced as just "navigation", which
          is no help when there are two of them. */}
      <nav
        aria-label={t("app.navigation")}
        className="flex-1 overflow-y-auto px-2 py-3"
        onClick={onNavigate}
      >
        {collapsed ? (
          // Icons only: no headings to fold, so everything is listed, with the
          // setup screens after a rule.
          <div className="flex flex-col gap-0.5">
            {daily.flatMap((g) => g.items).map(link)}
            {setup.length > 0 && <hr className="my-2 border-sidebar-border" />}
            {setup.map(link)}
          </div>
        ) : (
          <>
            {daily.map((group) =>
              // The English title is the fallback, so a nav entry added
              // before its translation still reads as something.
              section(group.title, group.messageKey ? t(group.messageKey) : group.title, group.items),
            )}
            {setup.length > 0 && (
              <div className="mt-2 border-t border-sidebar-border pt-2">
                {section(SETUP, t("nav.setup"), setup, t("nav.setupHint"))}
              </div>
            )}
          </>
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
        "hidden shrink-0 border-e border-sidebar-border transition-[width] duration-200 lg:flex lg:flex-col",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="relative flex-1">
        <SidebarContent navGroups={navGroups} collapsed={collapsed} tenantName={tenantName} />
      </div>
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="icon"
          className="w-full text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t("app.sidebar.expand") : t("app.sidebar.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>
    </aside>
  );
}
