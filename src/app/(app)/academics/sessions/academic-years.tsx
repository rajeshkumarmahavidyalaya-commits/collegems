"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarRange, CheckCircle2, Loader2, Pencil, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { TextField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import { useI18n } from "@/components/providers/i18n-provider";
import { formatDate } from "@/lib/i18n/format";
import {
  academicSessionSchema,
  type AcademicSessionInput,
} from "@/lib/validations/academics";
import {
  activateAcademicYear,
  createAcademicYear,
  updateAcademicYear,
  type AcademicYear,
} from "./actions";

function YearDialog({
  open,
  onOpenChange,
  year,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  year?: AcademicYear;
  onDone: () => void;
}) {
  const isEdit = !!year;
  const [makeCurrent, setMakeCurrent] = useState(false);

  const form = useForm<AcademicSessionInput>({
    resolver: zodResolver(academicSessionSchema),
    values: year
      ? { name: year.name, startDate: year.startDate, endDate: year.endDate }
      : { name: "", startDate: "", endDate: "" },
  });

  async function onSubmit(values: AcademicSessionInput) {
    const result = isEdit
      ? await updateAcademicYear(year.id, values)
      : await createAcademicYear(values, makeCurrent);

    if (!result.ok) {
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof AcademicSessionInput, { message: messages[0] });
        }
      }
      // The overlap refusal arrives as a sentence from the constraint's own
      // handler, and it names the year that clashes — so it goes to the toast
      // whole rather than being attached to one field it is not really about.
      toast.error(result.error);
      return;
    }

    toast.success(isEdit ? "Year updated" : "Year created");
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${year.name}` : "Add an academic year"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Moving the dates also moves every bus seat and hostel bed made for this year. If that would push one outside the year, the change is refused."
              : "Years may not overlap: every row filed by date has to belong to exactly one of them."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
              description="Whatever this school calls it — 2026-2027, or Session 12."
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="startDate"
                label="First day"
                type="date"
                required
              />
              <TextField
                control={form.control}
                name="endDate"
                label="Last day"
                type="date"
                required
              />
            </div>

            {!isEdit && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="make-current"
                  checked={makeCurrent}
                  onCheckedChange={(v) => setMakeCurrent(v === true)}
                />
                <div className="grid gap-1">
                  <Label htmlFor="make-current">Make this the current year</Label>
                  <p className="text-xs text-muted-foreground">
                    Everything written from then on is filed under it.
                  </p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {isEdit ? "Save changes" : "Add year"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ActivateDialog({
  year,
  onOpenChange,
  onDone,
}: {
  year: AcademicYear | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!year) return;
    startTransition(async () => {
      const result = await activateAcademicYear(year.id);
      if (result.ok) {
        toast.success(`${year.name} is now the current year.`);
        onOpenChange(false);
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={!!year} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make {year?.name} the current year</DialogTitle>
          <DialogDescription>
            From now on, every register, invoice, receipt and homework task is filed under{" "}
            {year?.name}. Nothing already written moves — this changes where new rows go, not where
            old ones are.
          </DialogDescription>
        </DialogHeader>

        {year && year.enrolments === 0 && (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            No child is enrolled in {year.name} yet. Registers and invoices need an enrolment, so
            run a promotion before the school day starts.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Make it current
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AcademicYears({
  years,
  canManage,
}: {
  years: AcademicYear[];
  canManage: boolean;
}) {
  const router = useRouter();
  // Dates go through the formatter, never `toLocaleDateString("en-IN")` and
  // never the raw ISO string the database returns — `2026-03-31` is a value,
  // not a date somebody reads.
  const { locale } = useI18n();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [activating, setActivating] = useState<AcademicYear | null>(null);

  const current = years.find((y) => y.isCurrent);
  const staleCurrent = current?.hasEnded ?? false;
  const covering = years.find((y) => y.hasStarted && !y.hasEnded);

  function refresh() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {staleCurrent && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">
              {current!.name} ended on {formatDate(current!.endDate, locale)}, and is still the
              current year
            </CardTitle>
            <CardDescription>
              Everything written since then has been filed under it — invisible to every report of
              the year it belongs to, and counted in the year it does not.
              {covering
                ? ` ${covering.name} covers today.`
                : " No year covers today; add one first."}
            </CardDescription>
          </CardHeader>
          {canManage && covering && (
            <CardContent>
              <Button onClick={() => setActivating(covering)}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Make {covering.name} current
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      <div className="flex justify-end">
        {canManage && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add year
          </Button>
        )}
      </div>

      {years.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No academic years yet</CardTitle>
            <CardDescription>
              A year is what every register, invoice and mark is filed under. Add the one the school
              is in now.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {years.map((y) => (
            <Card key={y.id} className={y.isCurrent ? "border-primary/50" : undefined}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{y.name}</CardTitle>
                  {y.isCurrent && <Badge variant="success">Current</Badge>}
                  {y.hasEnded && <Badge variant="secondary">Ended</Badge>}
                  {!y.hasStarted && <Badge variant="secondary">Not started</Badge>}
                </div>
                <CardDescription className="flex items-center gap-1.5">
                  <CalendarRange className="size-3.5" aria-hidden="true" />
                  {formatDate(y.startDate, locale)} — {formatDate(y.endDate, locale)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Enrolled</dt>
                    <dd className="tabular-nums">{y.enrolments}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Sections</dt>
                    <dd className="tabular-nums">{y.sections}</dd>
                  </div>
                </dl>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {!y.isCurrent && (
                      <Button size="sm" variant="outline" onClick={() => setActivating(y)}>
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        Make current
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(y)}>
                      <Pencil className="size-4" aria-hidden="true" />
                      Edit
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <YearDialog open={adding} onOpenChange={setAdding} onDone={refresh} />
      {editing && (
        <YearDialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          year={editing}
          onDone={refresh}
        />
      )}
      <ActivateDialog
        year={activating}
        onOpenChange={(v) => !v && setActivating(null)}
        onDone={refresh}
      />
    </div>
  );
}
