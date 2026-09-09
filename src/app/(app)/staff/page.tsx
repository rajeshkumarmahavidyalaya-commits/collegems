import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { StaffTable } from "./staff-table";

export const metadata = { title: "Staff" };

/**
 * The staff roster.
 *
 * `hasPermission("staff.manage")` here decides whether an *Add* button is
 * drawn; it is not the gate on the list. The list is gated inside
 * `staff_roster`, because RLS on `staff` is role-wide and the matrix is the
 * only thing that expresses "an accountant may not open this" (rule 4). A
 * caller without `staff.view` gets an error from Postgres, not an empty table.
 */
export default async function StaffPage() {
  const [ctx, canManage] = await Promise.all([getUserContext(), hasPermission("staff.manage")]);

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
          <Button asChild>
            <Link href="/staff/new">
              <UserPlus className="size-4" aria-hidden="true" />
              Add staff
            </Link>
          </Button>
        )}
      </div>

      <StaffTable canManage={canManage} />
    </div>
  );
}
