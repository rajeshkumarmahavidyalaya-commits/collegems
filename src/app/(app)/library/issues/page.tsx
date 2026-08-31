import { hasPermission } from "@/lib/auth/permissions";
import { IssuesTable } from "./issues-table";

export const metadata = { title: "Issues & returns" };

export default async function IssuesPage() {
  const canManage = await hasPermission("library.return");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Issues &amp; returns</h1>
        <p className="text-sm text-muted-foreground">
          Everything currently out, everything overdue, and everything returned.
        </p>
      </div>
      <IssuesTable canManage={canManage} />
    </div>
  );
}
