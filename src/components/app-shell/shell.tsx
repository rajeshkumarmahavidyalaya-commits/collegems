"use client";

import { useEffect, useState } from "react";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DesktopSidebar, SidebarContent } from "./app-sidebar";
import { AppBreadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { navForRole } from "./nav-config";

export function AppShell({
  roleCode,
  tenantName,
  currentSessionName,
  displayName,
  roleName,
  unreadCount,
  children,
}: {
  /**
   * The role code, not a built nav tree. Nav items carry Lucide icon
   * *components*, and functions cannot cross the server/client boundary --
   * passing them in throws "Functions cannot be passed directly to Client
   * Components" and takes down every authenticated page. Only serializable
   * props come in; the tree is built here, on the client.
   */
  roleCode: string;
  tenantName: string;
  currentSessionName: string | null;
  displayName: string;
  roleName: string;
  /** Unread in-app messages, resolved server-side in the layout. */
  unreadCount: number;
  children: React.ReactNode;
}) {
  const navGroups = navForRole(roleCode);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("schoolos:sidebar-collapsed");
    if (stored) setCollapsed(stored === "true");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("schoolos:sidebar-collapsed", String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-svh w-full">
      <DesktopSidebar
        navGroups={navGroups}
        tenantName={tenantName}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarContent navGroups={navGroups} tenantName={tenantName} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-svh flex-1 flex-col">
        <header
          data-print="hide"
          className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4"
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="size-5" />
          </Button>

          <AppBreadcrumbs />

          {currentSessionName && (
            <span className="hidden rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground md:inline">
              {currentSessionName}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <CommandPaletteTrigger />
            <NotificationBell unreadCount={unreadCount} />
            <ThemeToggle />
            <UserMenu displayName={displayName} roleName={roleName} />
          </div>
        </header>

        <main id="main-content" className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

function CommandPaletteTrigger() {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  return (
    <Button
      variant="outline"
      size="sm"
      className="hidden text-muted-foreground sm:inline-flex"
      onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
    >
      <Search className="size-3.5" aria-hidden="true" />
      Search
      <kbd className="ml-2 rounded border bg-muted px-1.5 font-mono text-[10px]">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </Button>
  );
}
