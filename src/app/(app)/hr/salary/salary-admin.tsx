"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Calculator, Pencil, Plus, Sigma, UserCog } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  formatMoney,
  formatOverrides,
  salaryAssignmentSchema,
  salaryStructureSchema,
  type SalaryAssignmentInput,
  type SalaryStructureInput,
} from "@/lib/validations/hr";
import {
  saveAssignment,
  saveStructure,
  type AssignmentRow,
  type StructureRow,
} from "../actions";

type Props = {
  structures: StructureRow[];
  assignments: AssignmentRow[];
  staff: { id: string; label: string; designation: string }[];
  canManage: boolean;
};

export function SalaryAdmin({ structures, assignments, staff, canManage }: Props) {
  const [structureOpen, setStructureOpen] = useState(false);
  const [editingStructure, setEditingStructure] = useState<StructureRow | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<AssignmentRow | null>(null);

  return (
    <Tabs defaultValue="structures">
      <TabsList>
        <TabsTrigger value="structures">Structures</TabsTrigger>
        <TabsTrigger value="assignments">Who is on what</TabsTrigger>
      </TabsList>

      <TabsContent value="structures" className="mt-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Salary structures</CardTitle>
              <CardDescription className="max-w-2xl">
                A structure is the <em>shape</em> — that house rent allowance is 40% of basic. The
                assignment is the <em>money</em>. Evaluation order is part of the contract: earnings
                resolve first, proration second, deductions third, against the amounts actually
                paid.
              </CardDescription>
            </div>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingStructure(null);
                  setStructureOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                New structure
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {structures.length === 0 ? (
              <EmptyState
                icon={Sigma}
                title="No salary structures"
                body="A structure lists what a salary is made of. Until one exists, payroll has nothing to compute."
                action={
                  canManage ? (
                    <Button variant="outline" size="sm" onClick={() => setStructureOpen(true)}>
                      <Plus className="size-4" aria-hidden="true" />
                      New structure
                    </Button>
                  ) : null
                }
              />
            ) : (
              structures.map((structure) => (
                <div key={structure.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {structure.name}
                        {!structure.isActive && <Badge variant="outline">Inactive</Badge>}
                        <Badge variant="secondary">
                          {structure.assignedCount}{" "}
                          {structure.assignedCount === 1 ? "person" : "people"}
                        </Badge>
                      </p>
                      {structure.description && (
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                          {structure.description}
                        </p>
                      )}
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingStructure(structure);
                          setStructureOpen(true);
                        }}
                        aria-label={`Edit ${structure.name}`}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>

                  <ComponentTable components={structure.components} />

                  {/* Criticism comes from Postgres, next to the engine, so the
                      thing that judges a document and the thing that evaluates
                      it cannot drift. */}
                  {structure.problems.length > 0 && (
                    <div className="mt-3 rounded-md border border-border bg-accent/40 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <AlertTriangle className="size-4 text-brand-accent" aria-hidden="true" />
                        Worth a look
                      </p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                        {structure.problems.map((problem) => (
                          <li key={problem}>{problem}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="assignments" className="mt-4">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Who is on what</CardTitle>
              <CardDescription className="max-w-2xl">
                A raise closes the old row and opens a new one, so last March&apos;s payslip can
                still be recomputed against last March&apos;s pay. Two salaries in force on the same
                day are refused by the database.
              </CardDescription>
            </div>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditingAssignment(null);
                  setAssignmentOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                Assign a salary
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {assignments.length === 0 ? (
              <EmptyState
                icon={UserCog}
                title="Nobody has a salary yet"
                body="Payroll builds a payslip for everybody with an assignment covering the month. Without one, a run produces nothing."
                action={
                  canManage ? (
                    <Button variant="outline" size="sm" onClick={() => setAssignmentOpen(true)}>
                      <Plus className="size-4" aria-hidden="true" />
                      Assign a salary
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Structure</TableHead>
                      <TableHead>Amounts</TableHead>
                      <TableHead>In force</TableHead>
                      <TableHead className="w-16 text-right">Edit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.employeeCode}
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{row.staffName}</p>
                          <p className="text-xs text-muted-foreground">{row.designation}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.structureName}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {Object.entries(row.overrides).length === 0 ? (
                            <span className="text-muted-foreground">Structure defaults</span>
                          ) : (
                            Object.entries(row.overrides).map(([code, value]) => (
                              <span key={code} className="block">
                                {code} {formatMoney(value as number)}
                              </span>
                            ))
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.effectiveFrom}
                          {row.effectiveTo ? ` – ${row.effectiveTo}` : " onwards"}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingAssignment(row);
                                setAssignmentOpen(true);
                              }}
                              aria-label={`Edit ${row.staffName}'s salary`}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
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
      </TabsContent>

      <StructureDialog
        open={structureOpen}
        onOpenChange={setStructureOpen}
        structure={editingStructure}
      />
      <AssignmentDialog
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        assignment={editingAssignment}
        structures={structures}
        staff={staff}
      />
    </Tabs>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Sigma;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="rounded-full bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

type Component = {
  code?: string;
  name?: string;
  kind?: string;
  calc?: string;
  amount?: number;
  of?: string;
  percent?: number;
  cap?: number;
};

function ComponentTable({ components }: { components: unknown }) {
  const document = components as { components?: Component[]; lop?: unknown } | null;
  const list = document?.components ?? [];

  if (list.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No components.</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>How</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((c, i) => (
            <TableRow key={`${c.code}-${i}`}>
              <TableCell>
                <span className="font-medium">{c.name ?? c.code}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{c.code}</span>
              </TableCell>
              <TableCell>
                <Badge variant={c.kind === "deduction" ? "outline" : "secondary"}>
                  {c.kind === "deduction" ? "Deduction" : "Earning"}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {c.calc === "percent_of"
                  ? `${c.percent}% of ${c.of}${c.cap ? `, capped at ${c.cap}` : ""}`
                  : `Fixed ${c.amount ?? "—"}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!document?.lop && (
        <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <Calculator className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          No loss-of-pay rule, so an absence does not reduce a payslip on this structure. That is
          the default when the document says nothing: a school that wants to dock unpaid leave says
          so.
        </p>
      )}
    </div>
  );
}

function StructureDialog({
  open,
  onOpenChange,
  structure,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structure: StructureRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<SalaryStructureInput>({
    resolver: zodResolver(salaryStructureSchema),
    values: {
      name: structure?.name ?? "",
      description: structure?.description ?? "",
      isActive: structure?.isActive ?? true,
      components: JSON.stringify(
        structure?.components ?? { components: [] },
        null,
        2,
      ),
    },
  });

  const isActive = form.watch("isActive");

  function onSubmit(input: SalaryStructureInput) {
    startTransition(async () => {
      const result = await saveStructure(input, structure?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof SalaryStructureInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success(structure ? "Structure updated." : "Structure created.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{structure ? "Edit structure" : "New salary structure"}</DialogTitle>
          <DialogDescription>
            The order of the components is the order they are evaluated in: a percentage may only
            refer to a code defined above it. Leave out the <code>lop</code> block and absences will
            not reduce pay.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <TextField control={form.control} name="name" label="Name" required />
            <TextareaField
              control={form.control}
              name="description"
              label="Description"
              rows={2}
              description="What kind of employee this is for, and anything unusual about it."
            />

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <Label htmlFor="structure-active" className="text-sm font-medium">
                Active
              </Label>
              <Switch
                id="structure-active"
                checked={isActive}
                onCheckedChange={(v) => form.setValue("isActive", v)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="structure-components">Components (JSON)</Label>
              <Textarea
                id="structure-components"
                rows={16}
                className="font-mono text-xs"
                {...form.register("components")}
              />
              {form.formState.errors.components && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.components.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Saving a half-finished document is allowed. Whether it makes sense is reported on
                the structure itself, by the database that evaluates it.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentDialog({
  open,
  onOpenChange,
  assignment,
  structures,
  staff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: AssignmentRow | null;
  structures: StructureRow[];
  staff: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<SalaryAssignmentInput>({
    resolver: zodResolver(salaryAssignmentSchema),
    values: {
      staffId: assignment?.staffId ?? "",
      structureId: assignment?.structureId ?? "",
      overrides: formatOverrides(assignment?.overrides),
      effectiveFrom: assignment?.effectiveFrom ?? "",
      effectiveTo: assignment?.effectiveTo ?? "",
      note: "",
    },
  });

  function onSubmit(input: SalaryAssignmentInput) {
    startTransition(async () => {
      const result = await saveAssignment(input, assignment?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof SalaryAssignmentInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success(assignment ? "Salary updated." : "Salary assigned.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{assignment ? "Edit salary" : "Assign a salary"}</DialogTitle>
          <DialogDescription>
            One amount per line, <code>CODE = amount</code>. Anything not named here keeps whatever
            the structure declares.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <SelectField
              control={form.control}
              name="staffId"
              label="Member of staff"
              required
              options={staff.map((s) => ({ value: s.id, label: s.label }))}
            />
            <SelectField
              control={form.control}
              name="structureId"
              label="Structure"
              required
              options={structures
                .filter((s) => s.isActive)
                .map((s) => ({ value: s.id, label: s.name }))}
            />

            <TextareaField
              control={form.control}
              name="overrides"
              label="Amounts"
              rows={4}
              placeholder="BASIC = 32000"
              description="One per line. The structure is the shape; this is the money."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="effectiveFrom"
                label="In force from"
                type="date"
                required
              />
              <TextField
                control={form.control}
                name="effectiveTo"
                label="Until"
                type="date"
                description="Leave blank for current."
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
