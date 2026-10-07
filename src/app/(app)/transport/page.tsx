import Link from "next/link";
import { Bus, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { ModuleCards } from "@/components/module-cards";

export const metadata = { title: "Transport" };

export default async function TransportPage() {
  const [ctx, canView, canManage, canCollect] = await Promise.all([
    getUserContext(),
    hasPermission("transport.view"),
    hasPermission("transport.manage"),
    hasPermission("fees.collect"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Transport Routes</h1>
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
          <h1 className="text-2xl font-semibold">Transport Routes</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Routes running in {ctx?.currentSessionName ?? "the current session"}. A route is a{" "}
            <span className="font-medium">trip</span>, not a bus: one vehicle doing a morning and an
            afternoon run has its seats twice, so each route counts its own.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* The reference's Transport Invoices, which is a catalogue report
              (0353) gated where the report is: on the permission that takes fees. */}
          {canCollect && (
            <Button asChild variant="outline">
              <Link href="/reports?report=transport.invoices">
                <ReceiptText className="size-4" aria-hidden="true" />
                Transport Invoices
              </Link>
            </Button>
          )}
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
      </div>
      <ModuleCards module="transport" />

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
