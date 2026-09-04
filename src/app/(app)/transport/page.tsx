import { Bus } from "lucide-react";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listStaffOptions } from "../hr/actions";
import {
  getBillingConflicts,
  listFeeHeads,
  listRoutes,
  listVehicles,
} from "./actions";
import { TransportView } from "./transport-view";

export const metadata = { title: "Transport" };

export default async function TransportPage() {
  const [ctx, canView, canManage] = await Promise.all([
    getUserContext(),
    hasPermission("transport.view"),
    hasPermission("transport.manage"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Transport</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Routes and buses are visible to the office. Ask an administrator to grant you{" "}
            <code className="font-mono">transport.view</code>.
          </p>
        </div>
      </div>
    );
  }

  const [routes, vehicles, conflicts, feeHeads, staff] = await Promise.all([
    listRoutes(),
    listVehicles(),
    getBillingConflicts(),
    listFeeHeads(),
    listStaffOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transport</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Routes running in {ctx?.currentSessionName ?? "the current session"}. A route is a{" "}
            <span className="font-medium">trip</span>, not a bus: one vehicle doing a morning and an
            afternoon run has its seats twice, so each route counts its own.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <Bus className="size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-mono text-lg font-semibold tabular-nums">
              {routes.reduce((sum, r) => sum + r.assigned, 0)}
            </p>
            <p className="text-xs text-muted-foreground">children on a bus</p>
          </div>
        </div>
      </div>

      <TransportView
        routes={routes}
        vehicles={vehicles}
        conflicts={conflicts}
        feeHeads={feeHeads}
        staff={staff}
        canManage={canManage}
      />
    </div>
  );
}
