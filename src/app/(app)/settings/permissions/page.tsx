import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { getMatrix } from "./actions";
import { PermissionGrid } from "./permission-grid";

export const metadata: Metadata = { title: "What each role may do" };

/**
 * The second layer of rule 4, finally editable.
 *
 * `role_permissions` has gated every menu and every button since migration
 * `0005` and had **no write path in the product**. Rule 4's own sentence —
 * *"a school can grant a teacher `students.manage` any Tuesday"* — described a
 * college with somebody holding a database console.
 *
 * Two things this screen is careful not to be:
 *
 * - **It is not the boundary.** RLS is, and it compares `current_role_code()`
 *   rather than this matrix, so clearing every box does not expose a row and
 *   ticking every box does not hand anybody another college's data. What this
 *   changes is what the product *offers*.
 * - **It is not a role editor.** Roles are per-college rows and a college may
 *   add its own later; this screen edits what the existing ones may do. Adding
 *   a seventh role is a different decision with a different screen.
 */
export default async function PermissionsPage() {
  const [matrix, canManage] = await Promise.all([getMatrix(), hasPermission("users.manage")]);

  if (!matrix) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-muted p-3">
            <ShieldAlert className="size-6 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-sm font-medium">This could not be loaded</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            The permission matrix is read through your own session, so this usually means the
            session has expired. Sign in again.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">What each role may do</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          This decides which menus and buttons each role is offered. It is not what protects the
          records — that is enforced in the database, per role, and does not change here.
        </p>
      </div>

      {/* Absent-and-withheld reads as a bug, so the reason is a sentence rather
          than a missing control — the dashboard's rule, on a screen instead of
          a card. */}
      {!canManage && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          You can see what each role may do, and only somebody with{" "}
          <span className="font-mono text-xs">users.manage</span> can change it.
        </div>
      )}

      <PermissionGrid matrix={matrix} canManage={canManage} />
    </div>
  );
}
