"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DesktopSidebar, SidebarContent } from "./app-sidebar";
import { AppBreadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { LanguageSwitcher } from "./language-switcher";
import { navForRole } from "./nav-config";
import { SchoolContext } from "./school-context";
import { useI18n, useT } from "@/components/providers/i18n-provider";

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
  const { t, direction } = useI18n();
  const navGroups = navForRole(roleCode);
  // The session link is offered where the sessions screen is already in this
  // person's menu; the screen checks academics.manage itself.
  const canManageSessions = navGroups.some((g) => g.items.some((i) => i.href === "/academics/sessions"));
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
    <div className="reference-app flex min-h-svh w-full flex-col">
      {/*
        The first focusable thing on every page.
        `main#main-content` has been the target of this link since the shell was
        written; the link itself was never rendered, and `app.skipToContent` sat
        translated into three languages with no caller. Without it a keyboard
        user tabs through nine navigation groups to reach the page they opened.

        Visible only when focused, which is the point: it is not decoration for
        people who never press Tab.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:start-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t("app.skipToContent")}
      </a>

      {/* The reference's green administration toolbar: the product, search,
          and the person's own controls, on every page. */}
      <header data-print="hide" className="reference-toolbar sticky top-0 z-30 flex h-9 items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label={t("app.openNav")}
        >
          <Menu className="size-4" />
        </Button>
        <Link href="/" className="reference-toolbar-brand">
          {t("app.toolbarBrand")}
        </Link>
        <CommandPaletteTrigger />
        <div className="ms-auto flex items-center gap-1">
          <NotificationBell unreadCount={unreadCount} />
          <LanguageSwitcher />
          <ThemeToggle />
          <UserMenu displayName={displayName} roleName={roleName} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <DesktopSidebar
          navGroups={navGroups}
          tenantName={tenantName}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          {/* The drawer comes in from the side the reader starts on. Left in
              Urdu would slide in from where the page ends. */}
          <SheetContent side={direction === "rtl" ? "right" : "left"} className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{t("app.navigation")}</SheetTitle>
            </SheetHeader>
            <SidebarContent navGroups={navGroups} tenantName={tenantName} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <div data-print="hide" className="reference-breadcrumbs flex min-h-9 items-center px-4 text-xs sm:px-8">
            <AppBreadcrumbs />
          </div>

          <main id="main-content" tabIndex={-1} className="reference-content flex-1 px-4 pb-8 focus:outline-none sm:px-8">
            <SchoolContext
              tenantName={tenantName}
              currentSessionName={currentSessionName}
              canManageSessions={canManageSessions}
            />
            <div className="reference-page">{children}</div>
          </main>
          <footer data-print="hide" className="reference-footer px-4 py-4 text-xs text-muted-foreground sm:px-8">
            {t("app.footer")}
          </footer>
        </div>
      </div>

      <CommandPalette navGroups={navGroups} />
    </div>
  );
}

function CommandPaletteTrigger() {
  const t = useT();
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="hidden h-7 text-xs sm:inline-flex"
      onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
    >
      <Search className="size-3.5" aria-hidden="true" />
      {t("app.search")}
      <kbd className="ms-1 rounded border border-current/30 px-1 font-mono text-[10px]">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </Button>
  );
}
