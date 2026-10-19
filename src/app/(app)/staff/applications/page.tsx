import Link from "next/link";
import { Briefcase, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { listApplications, type ApplicationStatus } from "./actions";
import { ApplicationsTable } from "./applications-table";

export const metadata = { title: "Staff Applications" };

const TABS: { status: ApplicationStatus; label: string }[] = [
  { status: "new", label: "New" },
  { status: "shortlisted", label: "Shortlisted" },
  { status: "hired", label: "Hired" },
  { status: "rejected", label: "Turned down" },
];

/**
 * Applications from the college's public jobs page (0361). The policies decide
 * who reads them (staff.manage); the page asks the same question first so a
 * seat without it sees a sentence rather than an empty table.
 */
export default async function StaffApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status: ApplicationStatus = TABS.some((t) => t.status === raw) ? (raw as ApplicationStatus) : "new";
  const [canManage, canSettings] = await Promise.all([hasPermission("staff.manage"), hasPermission("frontoffice.manage")]);

  if (!canManage) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Staff Applications" icon={Briefcase} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Applications are read by the people who add staff records. Your role does not.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { rows, total, counts } = await listApplications(status);

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Staff Applications" icon={Briefcase}>
        {canSettings && (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/school#setting-public.pages">
              <Settings className="size-4" aria-hidden="true" />
              Public pages
            </Link>
          </Button>
        )}
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        People who applied to work here from the college&apos;s public jobs page. Shortlist the ones to call, turn
        down the rest with a note for the office, and hire through the add-staff form, which starts filled in from
        the application.
      </p>
      <nav aria-label="Application status" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={`/staff/applications?status=${tab.status}`}
            aria-current={tab.status === status ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              tab.status === status ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {tab.label} ({counts[tab.status]})
          </Link>
        ))}
      </nav>
      <ApplicationsTable rows={rows} status={status} />
      {total > rows.length && (
        <p className="text-sm text-muted-foreground">
          Showing the first {rows.length} of {total}.
        </p>
      )}
    </div>
  );
}
