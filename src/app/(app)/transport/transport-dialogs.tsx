"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

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

import { ErrorSummary } from "@/components/forms/error-summary";

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import {
  DIRECTIONS,
  routeSchema,
  vehicleSchema,
  type RouteInput,
  type VehicleInput,
} from "@/lib/validations/transport";
import {
  saveRoute,
  saveVehicle,
  type RouteLoadRow,
  type VehicleRow,
} from "./actions";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function RouteDialog({
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
            A route is one trip. Give it a vehicle to have its seats counted,
            and a fee head so its fares reach the bill.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <TextField
              control={form.control}
              name="code"
              label="Code"
              required
            />
            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
            />
            <SelectField
              control={form.control}
              name="direction"
              label="Runs"
              options={DIRECTIONS.map((d) => ({
                value: d.value,
                label: d.label,
              }))}
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
                  A route that is not running keeps its children and its
                  history; nobody new can be put on it.
                </p>
              </div>
              <Switch
                id="route-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) =>
                  form.setValue("isActive", checked)
                }
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
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {route ? "Save route" : "Create route"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function VehicleDialog({
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
            Seats are what the vehicle is licensed to carry — the number on the
            door, and the number every route using it checks against.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

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
                value={
                  Number.isNaN(form.watch("capacity"))
                    ? ""
                    : form.watch("capacity")
                }
                onChange={(event) =>
                  form.setValue(
                    "capacity",
                    event.target.value === ""
                      ? NaN
                      : Number(event.target.value),
                    {
                      shouldValidate: true,
                    },
                  )
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
            <TextareaField
              control={form.control}
              name="notes"
              label="Notes"
              rows={2}
            />

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
                onCheckedChange={(checked) =>
                  form.setValue("isActive", checked)
                }
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
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {vehicle ? "Save vehicle" : "Add vehicle"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
