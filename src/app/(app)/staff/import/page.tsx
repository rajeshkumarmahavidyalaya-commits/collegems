import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { StaffImportView } from "./staff-import-view";

export const metadata = { title: "Import staff" };

/**
 * `hasPermission` decides what is drawn; `staff_admit` is the gate, and refuses
 * every row for a role without `staff.manage` whatever this page shows.
 */
export default async function StaffImportPage() {
  const canManage = await hasPermission("staff.manage");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Import staff</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Load a spreadsheet of staff instead of typing each one in. Nothing is added until you
            have seen every row, fixed what is wrong and pressed <strong>Add</strong>.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Staff
          </Link>
        </Button>
      </div>

      {canManage ? (
        <StaffImportView />
      ) : (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Adding staff needs <code className="font-mono">staff.manage</code>, which your role does
          not hold.
        </p>
      )}
    </div>
  );
}
