"use client";

import { useState } from "react";
import Link from "next/link";

import {
  AlertTriangle,
  Bus,
  Pencil,
  Plus,
  Route as RouteIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  directionLabel,
  occupancyTone,
  seatsSentence,
} from "@/lib/validations/transport-display";
import { type RouteLoadRow, type VehicleRow } from "./actions";
import { useI18n } from "@/components/providers/i18n-provider";

import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const RouteDialog = dynamic(() =>
  import("./transport-dialogs").then((m) => m.RouteDialog),
);
const VehicleDialog = dynamic(() =>
  import("./transport-dialogs").then((m) => m.VehicleDialog),
);

type Props = {
  routes: RouteLoadRow[];
  vehicles: VehicleRow[];
  conflicts: string[];
  feeHeads: { id: string; label: string }[];
  staff: { id: string; label: string }[];
  canManage: boolean;
};

export function TransportView({
  routes,
  vehicles,
  conflicts,
  feeHeads,
  staff,
  canManage,
}: Props) {
  const [routeOpen, setRouteOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RouteLoadRow | null>(null);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {conflicts.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Some families would be billed twice</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-4">
              {conflicts.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="routes">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="routes">Routes</TabsTrigger>
            <TabsTrigger value="fleet">Vehicles</TabsTrigger>
          </TabsList>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                onClick={() => {
                  setEditingVehicle(null);
                  setVehicleOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add New Vehicle
              </Button>
              <Button
                size="sm"
                className="cursor-pointer"
                onClick={() => {
                  setEditingRoute(null);
                  setRouteOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add New Route
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="routes" className="mt-4">
          <RoutesTab
            routes={routes}
            canManage={canManage}
            onEdit={(route) => {
              setEditingRoute(route);
              setRouteOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="fleet" className="mt-4">
          <FleetTab
            vehicles={vehicles}
            canManage={canManage}
            onEdit={(vehicle) => {
              setEditingVehicle(vehicle);
              setVehicleOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      {routeOpen ? (
        <RouteDialog
          open={routeOpen}
          onOpenChange={setRouteOpen}
          route={editingRoute}
          vehicles={vehicles}
          feeHeads={feeHeads}
        />
      ) : null}
      {vehicleOpen ? (
        <VehicleDialog
          open={vehicleOpen}
          onOpenChange={setVehicleOpen}
          vehicle={editingVehicle}
          staff={staff}
        />
      ) : null}
    </div>
  );
}

function RoutesTab({
  routes,
  canManage,
  onEdit,
}: {
  routes: RouteLoadRow[];
  canManage: boolean;
  onEdit: (route: RouteLoadRow) => void;
}) {
  const { t, formatCurrency } = useI18n();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Routes</CardTitle>
          <CardDescription className="max-w-2xl">
            Each route carries its own seat count. The fare is on the stop, not
            the route, because that is where the money actually varies.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {routes.length === 0 ? (
          <EmptyState
            icon={
              <RouteIcon
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            }
            title="No routes this session"
            body="A route is one trip a bus makes. Add one, give it stops with fares, and children can be assigned to it."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route Name</TableHead>
                  <TableHead>Route Fare</TableHead>
                  <TableHead>Number of Vehicles</TableHead>
                  <TableHead>Seats</TableHead>
                  {canManage && <TableHead className="w-20 text-end">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((route) => {
                  const tone = occupancyTone(route.capacity, route.assigned);
                  return (
                    <TableRow key={route.routeId}>
                      <TableCell>
                        <Link
                          href={`/transport/${route.routeId}`}
                          className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {route.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          <span className="font-mono">{route.code}</span> · {directionLabel(route.direction, t)} ·{" "}
                          {route.stopCount} {route.stopCount === 1 ? "stop" : "stops"}
                          {!route.isActive && " · not running"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {route.fareMin === null ? (
                          <span className="font-sans text-xs text-muted-foreground">No stops yet</span>
                        ) : route.fareMin === route.fareMax ? (
                          formatCurrency(route.fareMin)
                        ) : (
                          `${formatCurrency(route.fareMin)} – ${formatCurrency(route.fareMax)}`
                        )}
                        {route.fareMin !== null && (
                          <span className="block font-sans text-xs text-muted-foreground">a month, by stop</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {route.registrationNumber ? (
                          <>
                            1 <span className="font-mono text-muted-foreground">({route.registrationNumber})</span>
                            {route.driverName && (
                              <span className="block text-xs text-muted-foreground">{route.driverName}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">0 · not assigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* Text first, colour second: a full bus must read as
                            full in a black-and-white printout too. */}
                        <Badge
                          variant={
                            tone === "full"
                              ? "destructive"
                              : tone === "warn"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {seatsSentence(route.capacity, route.assigned)}
                        </Badge>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(route)}
                            className="cursor-pointer"
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            <span className="sr-only">Edit {route.code}</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FleetTab({
  vehicles,
  canManage,
  onEdit,
}: {
  vehicles: VehicleRow[];
  canManage: boolean;
  onEdit: (vehicle: VehicleRow) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Vehicles</CardTitle>
          <CardDescription className="max-w-2xl">
            Vehicles are not tied to a session — a bus the school owns outlives
            an academic year. Changing a vehicle&apos;s seat count updates every
            route that uses it.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {vehicles.length === 0 ? (
          <EmptyState
            icon={
              <Bus
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            }
            title="No vehicles yet"
            body="Add the buses and vans the school runs. A route without a vehicle still works — it simply has no seat limit to check against."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Vehicle Model</TableHead>
                  <TableHead>Driver Name</TableHead>
                  <TableHead>Driver Phone</TableHead>
                  <TableHead>In-charge</TableHead>
                  {canManage && <TableHead className="w-20 text-end">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell>
                      <span className="font-mono font-medium">{vehicle.registrationNumber}</span>
                      <span className="block text-xs text-muted-foreground">
                        {vehicle.capacity} seats · {vehicle.routeCount}{" "}
                        {vehicle.routeCount === 1 ? "route" : "routes"} ·{" "}
                        {vehicle.isActive ? "in service" : "off the road"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vehicle.model ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{vehicle.driverName ?? "Not recorded"}</TableCell>
                    <TableCell>
                      {vehicle.driverPhone ? (
                        <a href={`tel:${vehicle.driverPhone}`} className="font-mono underline-offset-4 hover:underline">
                          {vehicle.driverPhone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vehicle.attendantName ?? "Not recorded"}</TableCell>
                    {canManage && (
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(vehicle)}
                          className="cursor-pointer"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          <span className="sr-only">Edit {vehicle.registrationNumber}</span>
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="rounded-full bg-muted p-3">{icon}</span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
