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
  HOSTEL_KINDS,
  hostelSchema,
  roomSchema,
  type HostelInput,
  type RoomInput,
} from "@/lib/validations/hostel";
import { saveHostel, saveRoom, type HostelRow, type RoomRow } from "./actions";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function HostelDialog({
  open,
  onOpenChange,
  hostel,
  feeHeads,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostel: HostelRow | null;
  feeHeads: { id: string; label: string }[];
  staff: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<HostelInput>({
    resolver: zodResolver(hostelSchema),
    values: {
      name: hostel?.name ?? "",
      kind: (hostel?.kind ?? "mixed") as HostelInput["kind"],
      wardenStaffId: hostel?.wardenStaffId ?? "",
      feeHeadId: hostel?.feeHeadId ?? "",
      address: hostel?.address ?? "",
      isActive: hostel?.isActive ?? true,
    },
  });

  function onSubmit(values: HostelInput) {
    startTransition(async () => {
      const result = await saveHostel(values, hostel?.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(hostel ? "House updated." : "House added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {hostel ? "Edit house" : "New boarding house"}
          </DialogTitle>
          <DialogDescription>
            Give it a fee head so its room fares reach the bill, and a warden so
            the register has somebody&apos;s name on it.
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
              name="name"
              label="Name"
              required
            />
            <SelectField
              control={form.control}
              name="kind"
              label="Takes"
              options={HOSTEL_KINDS.map((k) => ({
                value: k.value,
                label: k.label,
              }))}
              description="A gendered house refuses a placement that does not match — unless the child's gender is not recorded, which is not a refusal."
            />
            <SelectField
              control={form.control}
              name="wardenStaffId"
              label="Warden"
              options={[
                { value: "", label: "Not recorded" },
                ...staff.map((s) => ({ value: s.id, label: s.label })),
              ]}
            />
            <SelectField
              control={form.control}
              name="feeHeadId"
              label="Fee head"
              options={[
                { value: "", label: "Do not charge for this house" },
                ...feeHeads.map((h) => ({ value: h.id, label: h.label })),
              ]}
              description="Which head a room's fare posts to on the invoice."
            />
            <TextareaField
              control={form.control}
              name="address"
              label="Address"
              rows={2}
            />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="hostel-active">Open</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  A closed house keeps its boarders and its history; nobody new
                  can be placed.
                </p>
              </div>
              <Switch
                id="hostel-active"
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
                className="cursor-pointer"
                onClick={() => onOpenChange(false)}
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
                {hostel ? "Save house" : "Add house"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function RoomDialog({
  open,
  onOpenChange,
  hostelId,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostelId: string;
  room: RoomRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<RoomInput>({
    resolver: zodResolver(roomSchema),
    values: {
      roomNumber: room?.roomNumber ?? "",
      floor: room?.floor ?? "",
      beds: room?.beds ?? 4,
      monthlyFare: room?.monthlyFare ?? 0,
      isActive: room?.isActive ?? true,
      notes: "",
    },
  });

  function onSubmit(values: RoomInput) {
    startTransition(async () => {
      const result = await saveRoom(
        room?.hostelId ?? hostelId,
        values,
        room?.roomId,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(room ? "Room updated." : "Room added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "New room"}</DialogTitle>
          <DialogDescription>
            Changing a fare here does not restate a bill already raised: a stay
            keeps the fare it was made at. Lowering the bed count below the
            children already in the room is not refused — the room simply reads
            as over its capacity until somebody moves them.
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
              name="roomNumber"
              label="Room number"
              required
            />
            <TextField control={form.control} name="floor" label="Floor" />

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberBox
                id="room-beds"
                label="Beds"
                required
                value={form.watch("beds")}
                error={form.formState.errors.beds?.message}
                onChange={(n) =>
                  form.setValue("beds", n, { shouldValidate: true })
                }
              />
              <NumberBox
                id="room-fare"
                label="Monthly fare"
                required
                step="0.01"
                value={form.watch("monthlyFare")}
                error={form.formState.errors.monthlyFare?.message}
                onChange={(n) =>
                  form.setValue("monthlyFare", n, { shouldValidate: true })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="room-active">In use</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Turn this off while a room is being repaired.
                </p>
              </div>
              <Switch
                id="room-active"
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
                className="cursor-pointer"
                onClick={() => onOpenChange(false)}
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
                {room ? "Save room" : "Add room"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function NumberBox({
  id,
  label,
  value,
  onChange,
  error,
  required,
  step,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        )}
      </Label>
      <input
        id={id}
        type="number"
        step={step}
        min={0}
        inputMode="decimal"
        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={Number.isNaN(value) ? "" : value}
        onChange={(event) =>
          onChange(event.target.value === "" ? NaN : Number(event.target.value))
        }
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
