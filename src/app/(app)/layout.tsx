import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/context";
import { AppShell } from "@/components/app-shell/shell";
import { getUnreadCount } from "./notifications/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();

  if (!ctx) {
    redirect("/login");
  }

  // After the auth check, not beside it: an unauthenticated request has no
  // inbox to count, and the RPC would only return zero the slow way.
  const unreadCount = await getUnreadCount();

  return (
    <AppShell
      roleCode={ctx.roleCode}
      tenantName={ctx.tenantName}
      currentSessionName={ctx.currentSessionName}
      displayName={ctx.displayName}
      roleName={ctx.roleName}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
