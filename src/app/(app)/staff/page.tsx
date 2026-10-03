import Link from "next/link";
import { FileUp, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { StaffTable } from "./staff-table";
import { ModuleCards } from "@/components/module-cards";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Staff" };

/**
 * The staff roster.
 *
 * `hasPermission("staff.manage")` here decides whether an *Add* button is
 * drawn; it is not the gate on the list. The list is gated inside
 * `staff_roster`, because RLS on `staff` is role-wide and the matrix is the
 * only thing that expresses "an accountant may not open this" (rule 4). A
 * caller without `staff.view` gets an error from Postgres, not an empty table.
 *
 * So the page asks the same question first and, for such a caller, says so
 * instead of mounting a table whose every read is refused. Mounted anyway, it
 * showed a loading skeleton through React Query's retries and then "That did
 * not load" -- a fault, to a teacher who had simply followed a link. Found in
 * the 3 Oct 2026 walkthrough. The function is still the gate; this decides
 * only which sentence is drawn.
 */
export default async function StaffPage() {
  const [ctx, canView, canManage, t] = await Promise.all([
    getUserContext(),
    hasPermission("staff.view"),
    hasPermission("staff.manage"),
    getT(),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <Card>
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            {t("idCard.staffWithheld")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            Everybody employed by {ctx?.tenantName ?? "this school"}, and what they are
            responsible for.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/staff/import">
                <FileUp className="size-4" aria-hidden="true" />
                Import from a spreadsheet
              </Link>
            </Button>
            <Button asChild>
              <Link href="/staff/new">
                <UserPlus className="size-4" aria-hidden="true" />
                Add staff
              </Link>
            </Button>
          </div>
        )}
      </div>
      <ModuleCards module="staff" />

      <StaffTable canManage={canManage} />
    </div>
  );
}
