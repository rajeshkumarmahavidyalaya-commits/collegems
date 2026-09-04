import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listAssignments, listStopOptions } from "../actions";
import { AssignmentsView } from "./assignments-view";

export const metadata = { title: "Transport assignments" };

export default async function AssignmentsPage() {
  const [canAssign, canView] = await Promise.all([
    hasPermission("transport.assign"),
    hasPermission("transport.view"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Transport assignments</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ask an administrator to grant you <code className="font-mono">transport.view</code>.
        </p>
      </div>
    );
  }

  const [stops, assignments] = await Promise.all([listStopOptions(), listAssignments()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transport assignments</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Which child boards where. A full bus, a child already on another route and a one-way
            route that cannot drop are all refused by the database with a sentence — this screen
            shows it rather than rewording it.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/transport">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Routes
          </Link>
        </Button>
      </div>

      <AssignmentsView stops={stops} assignments={assignments} canAssign={canAssign} />
    </div>
  );
}
