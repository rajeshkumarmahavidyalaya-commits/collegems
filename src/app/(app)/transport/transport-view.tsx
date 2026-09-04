"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Bus, Loader2, Pencil, Plus, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  DIRECTIONS,
  directionLabel,
  formatFare,
  occupancyTone,
  routeSchema,
  seatsSentence,
  vehicleSchema,
  type RouteInput,
  type VehicleInput,
} from "@/lib/validations/transport";
import { saveRoute, saveVehicle, type RouteLoadRow, type VehicleRow } from "./actions";

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
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
              {conflicts.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="routes">
        <TabsList>
          <TabsTrigger value="routes">Routes</TabsTrigger>
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
        </TabsList>

        <TabsContent value="routes" className="mt-4">
          <RoutesTab
            routes={routes}
            canManage={canManage}
            onAdd={() => {
              setEditingRoute(null);
              setRouteOpen(true);
            }}
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
            onAdd={() => {
              setEditingVehicle(null);
              setVehicleOpen(true);
            }}
            onEdit={(vehicle) => {
              setEditingVehicle(vehicle);
              setVehicleOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <RouteDialog
        open={routeOpen}
        onOpenChange={setRouteOpen}
        route={editingRoute}
        vehicles={vehicles}
        feeHeads={feeHeads}
      />
      <VehicleDialog
        open={vehicleOpen}
        onOpenChange={setVehicleOpen}
        vehicle={editingVehicle}
        staff={staff}
      />
    </div>
  );
}

function RoutesTab({
  routes,
  canManage,
  onAdd,
  onEdit,
}: {
  routes: RouteLoadRow[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (route: RouteLoadRow) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Routes</CardTitle>
          <CardDescription className="max-w-2xl">
            Each route carries its own seat count. The fare is on the stop, not the route, because
            that is where the money actually varies.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd} className="cursor-pointer">
            <Plus className="size-4" aria-hidden="true" />
            New route
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {routes.length === 0 ? (
          <EmptyState
            icon={<RouteIcon className="size-6 text-muted-foreground" aria-hidden="true" />}
            title="No routes this session"
            body="A route is one trip a bus makes. Add one, give it stops with fares, and children can be assigned to it."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Route</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="text-right">Stops</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead className="text-right">Monthly fares</TableHead>
                  <TableHead className="w-20 text-right">Edit</TableHead>
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
                          <span className="font-mono">{route.code}</span> · {route.name}
                        </Link>
                        {!route.isActive && (
                          <span className="ml-2 text-xs text-muted-foreground">(not running)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {directionLabel(route.direction)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {route.registrationNumber ? (
                          <span className="font-mono">{route.registrationNumber}</span>
                        ) : (
                          "Not assigned"
                        )}
                        {route.driverName && (
                          <span className="block text-xs">{route.driverName}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {route.stopCount}
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
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatFare(route.monthlyRevenue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(route)}
                            className="cursor-pointer"
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            <span className="sr-only">Edit {route.code}</span>
                          </Button>
                        )}
                      </TableCell>
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
  onAdd,
  onEdit,
}: {
  vehicles: VehicleRow[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (vehicle: VehicleRow) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Fleet</CardTitle>
          <CardDescription className="max-w-2xl">
            Vehicles are not tied to a session — a bus the school owns outlives an academic year.
            Changing a vehicle&apos;s seat count updates every route that uses it.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd} className="cursor-pointer">
            <Plus className="size-4" aria-hidden="true" />
            New vehicle
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {vehicles.length === 0 ? (
          <EmptyState
            icon={<Bus className="size-6 text-muted-foreground" aria-hidden="true" />}
            title="No vehicles yet"
            body="Add the buses and vans the school runs. A route without a vehicle still works — it simply has no seat limit to check against."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registration</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead className="text-right">Routes</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20 text-right">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id}>
                    <TableCell className="font-mono font-medium">
                      {vehicle.registrationNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vehicle.model ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {vehicle.capacity}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {vehicle.driverName ?? "Not recorded"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {vehicle.routeCount}
                    </TableCell>
                    <TableCell>
                      <Badge variant={vehicle.isActive ? "outline" : "secondary"}>
                        {vehicle.isActive ? "In service" : "Off the road"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(vehicle)}
                          className="cursor-pointer"
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                          <span className="sr-only">Edit {vehicle.registrationNumber}</span>
                        </Button>
                      )}
                    </TableCell>
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

function RouteDialog({
  open,
  onOpenChange,
  route,
  vehicles,
  feeHeads,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route: RouteLoadRow | null;
  vehicles: VehicleRow[];
  feeHeads: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<RouteInput>({
    resolver: zodResolver(routeSchema),
    values: {
      code: route?.code ?? "",
      name: route?.name ?? "",
      direction: (route?.direction ?? "both") as RouteInput["direction"],
      vehicleId: route?.vehicleId ?? "",
      feeHeadId: "",
      isActive: route?.isActive ?? true,
    },
  });

  function onSubmit(values: RouteInput) {
    startTransition(async () => {
      const result = await saveRoute(values, route?.routeId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(route ? "Route updated." : "Route created.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{route ? "Edit route" : "New route"}</DialogTitle>
          <DialogDescription>
            A route is one trip. Give it a vehicle to have its seats counted, and a fee head so its
            fares reach the bill.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField control={form.control} name="code" label="Code" required />
            <TextField control={form.control} name="name" label="Name" required />
            <SelectField
              control={form.control}
              name="direction"
              label="Runs"
              options={DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))}
              description="A one-way route can only carry children who need that run."
            />
            <SelectField
              control={form.control}
              name="vehicleId"
              label="Vehicle"
              options={[
                { value: "", label: "No vehicle yet" },
                ...vehicles.map((v) => ({
                  value: v.id,
                  label: `${v.registrationNumber} (${v.capacity} seats)`,
                })),
              ]}
              description="Without one there is no seat count to check against."
            />
            <SelectField
              control={form.control}
              name="feeHeadId"
              label="Fee head"
              options={[
                { value: "", label: "Do not charge for this route" },
                ...feeHeads.map((h) => ({ value: h.id, label: h.label })),
              ]}
              description="Which head a stop's fare posts to on the invoice."
            />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="route-active">Running</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  A route that is not running keeps its children and its history; nobody new can be
                  put on it.
                </p>
              </div>
              <Switch
                id="route-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) => form.setValue("isActive", checked)}
                className="cursor-pointer"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {route ? "Save route" : "Create route"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function VehicleDialog({
  open,
  onOpenChange,
  vehicle,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: VehicleRow | null;
  staff: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<VehicleInput>({
    resolver: zodResolver(vehicleSchema),
    values: {
      registrationNumber: vehicle?.registrationNumber ?? "",
      model: vehicle?.model ?? "",
      capacity: vehicle?.capacity ?? 40,
      driverStaffId: vehicle?.driverStaffId ?? "",
      attendantStaffId: "",
      isActive: vehicle?.isActive ?? true,
      notes: vehicle?.notes ?? "",
    },
  });

  function onSubmit(values: VehicleInput) {
    startTransition(async () => {
      const result = await saveVehicle(values, vehicle?.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(vehicle ? "Vehicle updated." : "Vehicle added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle ? "Edit vehicle" : "New vehicle"}</DialogTitle>
          <DialogDescription>
            Seats are what the vehicle is licensed to carry — the number on the door, and the number
            every route using it checks against.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField
              control={form.control}
              name="registrationNumber"
              label="Registration number"
              required
            />
            <TextField control={form.control} name="model" label="Model" />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vehicle-capacity">
                Seats
                <span aria-hidden="true" className="text-destructive">
                  {" "}
                  *
                </span>
              </Label>
              <input
                id="vehicle-capacity"
                type="number"
                min={1}
                max={200}
                inputMode="numeric"
                className="h-9 w-32 rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-invalid={form.formState.errors.capacity ? true : undefined}
                value={Number.isNaN(form.watch("capacity")) ? "" : form.watch("capacity")}
                onChange={(event) =>
                  form.setValue("capacity", event.target.value === "" ? NaN : Number(event.target.value), {
                    shouldValidate: true,
                  })
                }
              />
              {form.formState.errors.capacity && (
                <p role="alert" className="text-sm text-destructive">
                  {form.formState.errors.capacity.message}
                </p>
              )}
            </div>
            <SelectField
              control={form.control}
              name="driverStaffId"
              label="Driver"
              options={[
                { value: "", label: "Not recorded" },
                ...staff.map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
            <TextareaField control={form.control} name="notes" label="Notes" rows={2} />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="vehicle-active">In service</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Turn this off while a vehicle is off the road.
                </p>
              </div>
              <Switch
                id="vehicle-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) => form.setValue("isActive", checked)}
                className="cursor-pointer"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {vehicle ? "Save vehicle" : "Add vehicle"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
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
