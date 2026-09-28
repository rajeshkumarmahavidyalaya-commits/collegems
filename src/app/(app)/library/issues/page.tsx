import { hasPermission } from "@/lib/auth/permissions";
import { IssueBookDialog } from "../issue-book-dialog";
import { IssuesTable } from "./issues-table";
import { ModuleCards } from "@/components/module-cards";

export const metadata = { title: "Issues & returns" };

/**
 * The library counter. *Issue a book* lives here as well as on each book's
 * page, because the counter is where a borrower is standing; `?issue=1` opens
 * it straight from the home page's Library tile (0290).
 */
export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string }>;
}) {
  const [{ issue }, canManage, canIssue] = await Promise.all([
    searchParams,
    hasPermission("library.return"),
    hasPermission("library.issue"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Issues &amp; returns</h1>
          <p className="text-sm text-muted-foreground">
            Everything currently out, everything overdue, and everything returned.
          </p>
        </div>
        {canIssue && <IssueBookDialog defaultOpen={issue === "1"} />}
      </div>
      <ModuleCards module="library" />
      <IssuesTable canManage={canManage} />
    </div>
  );
}
