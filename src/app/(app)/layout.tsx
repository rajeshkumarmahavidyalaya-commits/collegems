import { redirect } from "next/navigation";
import { PauseCircle } from "lucide-react";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell/shell";
import { MODULE_PREFIXES } from "@/components/app-shell/nav-config";
import { getUnreadCount } from "./notifications/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();

  if (!ctx) {
    redirect("/login");
  }

  // After the auth check, not beside it: an unauthenticated request has no
  // inbox to count, and the RPC would only return zero the slow way.
  const supabase = await createClient();
  const [unreadCount, menu, tenant, canManageSchool] = await Promise.all([
    getUnreadCount(),
    supabase.rpc("setting_value", { p_key: "modules.menu" }),
    supabase.from("tenants").select("is_active").eq("id", ctx.tenantId).maybeSingle(),
    hasPermission("users.manage"),
  ]);

  // The school's own menu switches (0326): a module set to false is left out
  // of the menu. Presentation only -- every page still checks its permission.
  const switches = menu.data && typeof menu.data === "object" && !Array.isArray(menu.data) ? (menu.data as Record<string, unknown>) : {};
  const hiddenModules = Object.keys(MODULE_PREFIXES).filter((m) => switches[m] === false);

  // A paused school (0326) shows its members a notice instead of the app; its
  // administrators keep working, with the notice above every page so nobody
  // forgets. Not a boundary: data and logins are untouched, and RLS still
  // decides every read.
  const paused = tenant.data?.is_active === false;
  const pausedNotice = (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-lg border border-warning bg-warning/15 px-4 py-3 text-sm">
      <PauseCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{ctx.tenantName} is paused.</p>
        <p className="text-muted-foreground">
          {canManageSchool
            ? "You can still work in it as its administrator. Resume it under School Management › Schools."
            : "Its administrator has paused it for now. Nothing has been deleted; please check with the school office."}
        </p>
      </div>
    </div>
  );

  return (
    <AppShell
      roleCode={ctx.roleCode}
      tenantName={ctx.tenantName}
      currentSessionName={ctx.currentSessionName}
      displayName={ctx.displayName}
      roleName={ctx.roleName}
      unreadCount={unreadCount}
      hiddenModules={hiddenModules}
    >
      {paused ? (
        canManageSchool ? (
          <>
            {pausedNotice}
            {children}
          </>
        ) : (
          pausedNotice
        )
      ) : (
        children
      )}
    </AppShell>
  );
}
