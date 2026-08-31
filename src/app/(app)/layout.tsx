import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/context";
import { navForRole } from "@/components/app-shell/nav-config";
import { AppShell } from "@/components/app-shell/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getUserContext();

  if (!ctx) {
    redirect("/login");
  }

  return (
    <AppShell
      navGroups={navForRole(ctx.roleCode)}
      tenantName={ctx.tenantName}
      currentSessionName={ctx.currentSessionName}
      displayName={ctx.displayName}
      roleName={ctx.roleName}
    >
      {children}
    </AppShell>
  );
}
