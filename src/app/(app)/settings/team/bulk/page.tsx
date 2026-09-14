import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../../students/actions";
import { listRoles } from "../actions";
import { getDraftRun } from "./actions";
import { BulkInviteView } from "./bulk-invite-view";

export const metadata = { title: "Invite many" };

export default async function BulkInvitePage() {
  const [canManage, roles, sections, run] = await Promise.all([
    hasPermission("users.manage"),
    listRoles(),
    listSections(),
    getDraftRun(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invite many</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A whole class or the whole school at once. Nothing is sent until you have read the
            list.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/settings/team">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to invitations
          </Link>
        </Button>
      </div>

      {!canManage ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">Your role cannot invite people</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask an administrator, or have them grant your role the permission to manage users.
          </p>
        </div>
      ) : (
        <BulkInviteView
          roles={roles.filter((r) => r.subject !== "none")}
          sections={sections}
          run={run}
        />
      )}
    </div>
  );
}
