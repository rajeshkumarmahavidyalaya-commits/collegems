"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MapPin, Pencil, Plus, Printer, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
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
import { TextField } from "@/components/forms/form-fields";
import {
  directionLabel,
  formatFare,
  formatStopTime,
  stopSchema,
  type StopInput,
} from "@/lib/validations/transport";
import { deleteStop, saveStop, type ManifestRow, type StopRow } from "../actions";

export function RouteDetail({
  routeId,
  routeLabel,
  stops,
  manifest,
  canManage,
}: {
  routeId: string;
  routeLabel: string;
  stops: StopRow[];
  manifest: ManifestRow[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StopRow | null>(null);

  return (
    <>
      <Tabs defaultValue="manifest">
        <TabsList data-print="hide">
          <TabsTrigger value="manifest">Manifest</TabsTrigger>
          <TabsTrigger value="stops">Stops and fares</TabsTrigger>
        </TabsList>

        <TabsContent value="manifest" className="mt-4">
          <Manifest routeLabel={routeLabel} rows={manifest} />
        </TabsContent>

        <TabsContent value="stops" className="mt-4">
          <StopsTab
            stops={stops}
            canManage={canManage}
            onAdd={() => {
              setEditing(null);
              setOpen(true);
            }}
            onEdit={(stop) => {
              setEditing(stop);
              setOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <StopDialog
        open={open}
        onOpenChange={setOpen}
        routeId={routeId}
        stop={editing}
        nextSequence={stops.length + 1}
      />
    </>
  );
}

/**
 * The list a driver and an attendant actually use: stop by stop, who gets on,
 * and a number to ring when they are not there. It prints through the global
 * stylesheet, which is why the chrome carries `data-print` attributes.
 */
function Manifest({ routeLabel, rows }: { routeLabel: string; rows: ManifestRow[] }) {
  const riders = rows.filter((r) => r.studentId !== null);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Manifest</CardTitle>
          <CardDescription className="max-w-2xl">
            {routeLabel} — {riders.length} {riders.length === 1 ? "child" : "children"} today. Only
            the primary guardian&apos;s number is shown: a list with three numbers per child is one
            nobody reads on a roadside.
          </CardDescription>
        </div>
        <Button
          data-print="hide"
          type="button"
          variant="outline"
          onClick={() => window.print()}
          className="cursor-pointer"
        >
          <Printer className="size-4" aria-hidden="true" />
          Print
        </Button>
      </CardHeader>
      <CardContent>
        {riders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Users className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nobody on this route yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add stops with fares, then assign children to them from the assignments screen.
              </p>
            </div>
          </div>
        ) : (
          <div data-print="sheet" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Stop</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Child</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Guardian</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riders.map((row, index) => (
                  <TableRow key={`${row.stopId}-${row.studentId}-${index}`} data-print="keep">
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {row.sequence}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{row.stopName}</span>
                      {row.landmark && (
                        <span className="block text-xs text-muted-foreground">{row.landmark}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {formatStopTime(row.pickupTime)}
                      {row.dropTime ? ` / ${formatStopTime(row.dropTime)}` : ""}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{row.studentName}</span>
                      {row.admissionNumber && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {row.admissionNumber}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.sectionLabel ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.direction ? directionLabel(row.direction) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.guardianPhone ? (
                        <>
                          <a
                            href={`tel:${row.guardianPhone}`}
                            className="font-mono underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row.guardianPhone}
                          </a>
                          {row.guardianName && (
                            <span className="block text-xs text-muted-foreground">
                              {row.guardianName}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">No number on file</span>
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

function StopsTab({
  stops,
  canManage,
  onAdd,
  onEdit,
}: {
  stops: StopRow[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (stop: StopRow) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove(stop: StopRow) {
    if (!window.confirm(`Remove the stop "${stop.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteStop(stop.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Stop removed.");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Stops and fares</CardTitle>
          <CardDescription className="max-w-2xl">
            The fare belongs to the stop, so a child boarding two kilometres out pays less than one
            boarding twelve — on the same bus, in the same class. A school charging a flat fare puts
            the same number on every stop.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd} className="cursor-pointer">
            <Plus className="size-4" aria-hidden="true" />
            New stop
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {stops.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <MapPin className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">No stops on this route</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add the boarding points in the order the bus reaches them, each with its own monthly
                fare.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Stop</TableHead>
                  <TableHead>Pickup</TableHead>
                  <TableHead>Drop</TableHead>
                  <TableHead className="text-right">Monthly fare</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stops.map((stop) => (
                  <TableRow key={stop.id}>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {stop.sequence}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{stop.name}</span>
                      {stop.landmark && (
                        <span className="block text-xs text-muted-foreground">{stop.landmark}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {formatStopTime(stop.pickupTime)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {formatStopTime(stop.dropTime)}
                    </TableCell>
                    <TableCell className="text-right">
                      {stop.monthlyFare > 0 ? (
                        <span className="font-mono tabular-nums">
                          {formatFare(stop.monthlyFare)}
                        </span>
                      ) : (
                        <Badge variant="secondary">Free</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(stop)}
                            className="cursor-pointer"
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            <span className="sr-only">Edit {stop.name}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            onClick={() => remove(stop)}
                            className="cursor-pointer"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            <span className="sr-only">Remove {stop.name}</span>
                          </Button>
                        </>
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

function StopDialog({
  open,
  onOpenChange,
  routeId,
  stop,
  nextSequence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeId: string;
  stop: StopRow | null;
  nextSequence: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<StopInput>({
    resolver: zodResolver(stopSchema),
    values: {
      name: stop?.name ?? "",
      landmark: stop?.landmark ?? "",
      sequence: stop?.sequence ?? nextSequence,
      pickupTime: stop?.pickupTime?.slice(0, 5) ?? "",
      dropTime: stop?.dropTime?.slice(0, 5) ?? "",
      monthlyFare: stop?.monthlyFare ?? 0,
    },
  });

  function onSubmit(values: StopInput) {
    startTransition(async () => {
      const result = await saveStop(routeId, values, stop?.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(stop ? "Stop updated." : "Stop added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stop ? "Edit stop" : "New stop"}</DialogTitle>
          <DialogDescription>
            Changing a fare here does not restate a bill already raised: an arrangement keeps the
            fare it was made at.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField control={form.control} name="name" label="Stop name" required />
            <TextField control={form.control} name="landmark" label="Landmark" />

            <div className="grid gap-4 sm:grid-cols-3">
              <NumberBox
                id="stop-sequence"
                label="Position"
                required
                value={form.watch("sequence")}
                error={form.formState.errors.sequence?.message}
                onChange={(n) => form.setValue("sequence", n, { shouldValidate: true })}
              />
              <TextField control={form.control} name="pickupTime" label="Pickup (HH:MM)" />
              <TextField control={form.control} name="dropTime" label="Drop (HH:MM)" />
            </div>

            <NumberBox
              id="stop-fare"
              label="Monthly fare"
              required
              step="0.01"
              value={form.watch("monthlyFare")}
              error={form.formState.errors.monthlyFare?.message}
              onChange={(n) => form.setValue("monthlyFare", n, { shouldValidate: true })}
            />

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
                {stop ? "Save stop" : "Add stop"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A number input that keeps the form's value a number. `z.coerce` would split
 * the schema's input and output types and break the resolver, so the conversion
 * happens in the field — the convention this project settled on.
 */
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
        onChange={(event) => onChange(event.target.value === "" ? NaN : Number(event.target.value))}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
