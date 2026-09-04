import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { directionLabel, formatFare, seatsSentence } from "@/lib/validations/transport";
import { getManifest, listRoutes, listStops } from "../actions";
import { RouteDetail } from "./route-detail";

export const metadata = { title: "Route" };

export default async function RoutePage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;

  const [routes, stops, manifest, canManage] = await Promise.all([
    listRoutes(),
    listStops(routeId),
    getManifest(routeId),
    hasPermission("transport.manage"),
  ]);

  const route = routes.find((r) => r.routeId === routeId);
  if (!route) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">
              <span className="font-mono">{route.code}</span> · {route.name}
            </h1>
            <Badge variant={route.isActive ? "outline" : "secondary"}>
              {route.isActive ? "Running" : "Not running"}
            </Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{directionLabel(route.direction)}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden="true" />
              {seatsSentence(route.capacity, route.assigned)}
            </span>
            <span>{route.registrationNumber ?? "No vehicle"}</span>
            <span>{formatFare(route.monthlyRevenue)} a month in fares</span>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/transport">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All routes
          </Link>
        </Button>
      </div>

      <RouteDetail
        routeId={routeId}
        routeLabel={`${route.code} · ${route.name}`}
        stops={stops}
        manifest={manifest}
        canManage={canManage}
      />
    </div>
  );
}
