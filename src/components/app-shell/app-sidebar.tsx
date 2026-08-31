"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NavGroup } from "./nav-config";

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
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
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

  return (
    <div className="flex h-full flex-col gap-1 bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-14 items-center gap-2 border-b border-sidebar-border px-4", collapsed && "justify-center px-0")}>
        <GraduationCap className="size-5 shrink-0 text-sidebar-primary" aria-hidden="true" />
        {!collapsed && <span className="truncate font-semibold">{tenantName || "SchoolOS"}</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" onClick={onNavigate}>
        {navGroups.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1 text-xs font-medium text-sidebar-foreground/60 uppercase tracking-wide">
                {group.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  title={item.title}
                  collapsed={collapsed}
                  active={pathname === item.href}
                />
              ))}
            </div>
          </div>
        ))}
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
  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 lg:flex lg:flex-col",
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
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>
    </aside>
  );
}
