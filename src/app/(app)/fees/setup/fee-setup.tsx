"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, CreditCard, FileText, Loader2, Mail, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import { ErrorSummary } from "@/components/forms/error-summary";
import {
  FEE_CATEGORIES,
  FEE_FREQUENCIES,
  feeHeadSchema,
  feeStructureSchema,
  formatMoney,
  generateSectionInvoicesSchema,
  type FeeHeadInput,
  type FeeStructureInput,
} from "@/lib/validations/fees";
import {
  deleteFeeStructure,
  generateSectionInvoices,
  saveFeeHead,
  saveFeeIntegrationSettings,
  saveFeeStructure,
  saveSchoolProfile,
  type FeeIntegrationSettings,
} from "../actions";

type FeeHead = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
};

type FeeStructure = {
  id: string;
  amount: number;
  frequency: string;
  classLevel: string;
  feeHead: string;
  feeHeadCode: string;
};

function todayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function FeeSetup({
  feeHeads,
  structures,
  classLevels,
  sections,
  integrations,
  schoolProfile,
  canManageSettings,
}: {
  feeHeads: FeeHead[];
  structures: FeeStructure[];
  classLevels: { id: string; name: string }[];
  sections: { id: string; label: string }[];
  integrations: FeeIntegrationSettings;
  schoolProfile: SchoolProfile;
  canManageSettings: boolean;
}) {
  const router = useRouter();
  const [headOpen, setHeadOpen] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FeeStructure | null>(null);

  const activeHeads = feeHeads.filter((h) => h.is_active);

  // Structures grouped by class, because that is the unit a school thinks in:
  // "what does Grade 6 pay", not "what does the transport head cost everywhere".
  const byClass = structures.reduce<Record<string, FeeStructure[]>>((acc, s) => {
    (acc[s.classLevel] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="structures">
        <TabsList>
          <TabsTrigger value="structures">Class amounts</TabsTrigger>
          <TabsTrigger value="heads">Fee heads ({feeHeads.length})</TabsTrigger>
          <TabsTrigger value="billing">Raise invoices</TabsTrigger>
          {canManageSettings && <TabsTrigger value="integrations">Payments &amp; email</TabsTrigger>}
        </TabsList>

        <TabsContent value="structures" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              What each class pays this session. Setting an amount that already exists edits it
              rather than adding a second row.
            </p>
            <Button size="sm" onClick={() => setStructureOpen(true)} disabled={activeHeads.length === 0}>
              <Plus className="size-4" aria-hidden="true" />
              Set an amount
            </Button>
          </div>

          {activeHeads.length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>Add a fee head first</AlertTitle>
              <AlertDescription>
                A fee head is what you charge for — tuition, transport, exam fees. Amounts are set
                per class against a head.
              </AlertDescription>
            </Alert>
          ) : Object.keys(byClass).length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>No amounts set yet</AlertTitle>
              <AlertDescription>
                Until a class has amounts against it, invoices for that class cannot be raised.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Object.entries(byClass).map(([className, rows]) => (
                <Card key={className}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{className}</CardTitle>
                    <CardDescription className="font-mono tabular-nums">
                      {formatMoney(rows.reduce((s, r) => s + r.amount, 0))} per instalment set
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2 text-sm">
                      {rows.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate">{row.feeHead}</span>
                            <span className="text-xs text-muted-foreground capitalize">
                              {row.frequency.replace("_", " ")}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="font-mono tabular-nums">{formatMoney(row.amount)}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${row.feeHead} from ${className}`}
                              onClick={() => setConfirmDelete(row)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="heads" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              What the school charges for. A head is never deleted once it has been billed — mark it
              inactive instead, and it stops appearing on new invoices.
            </p>
            <Button size="sm" onClick={() => setHeadOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add fee head
            </Button>
          </div>

          {feeHeads.length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>No fee heads yet</AlertTitle>
              <AlertDescription>
                Start with the ones every school has: tuition, exam fee, transport.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Code</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Category</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {feeHeads.map((head) => (
                    <tr key={head.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{head.code}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{head.name}</span>
                        {head.description && (
                          <span className="block text-xs text-muted-foreground">
                            {head.description}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 capitalize">{head.category}</td>
                      <td className="px-3 py-2">
                        <Badge variant={head.is_active ? "success" : "outline"}>
                          {head.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="billing" className="mt-4 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Raising invoices for a class bills every enrolled student at that class&apos;s set
            amounts. Students who already have an invoice for that due date are skipped, so running
            it twice tops up rather than double-billing.
          </p>
          <div>
            <Button onClick={() => setBillOpen(true)} disabled={structures.length === 0}>
              <FileText className="size-4" aria-hidden="true" />
              Raise invoices for a class
            </Button>
          </div>
          {structures.length === 0 && (
            <Alert>
              <AlertTitle>Set class amounts first</AlertTitle>
              <AlertDescription>
                There is nothing to bill until at least one class has amounts against it.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {canManageSettings && (
          <TabsContent value="integrations" className="mt-4">
            <div className="flex flex-col gap-4">
              <SchoolProfileCard profile={schoolProfile} onDone={() => router.refresh()} />
              <IntegrationSettings settings={integrations} onDone={() => router.refresh()} />
            </div>
          </TabsContent>
        )}
      </Tabs>

      <FeeHeadDialog open={headOpen} onOpenChange={setHeadOpen} onDone={() => router.refresh()} />
      <FeeStructureDialog
        open={structureOpen}
        onOpenChange={setStructureOpen}
        classLevels={classLevels}
        feeHeads={activeHeads}
        onDone={() => router.refresh()}
      />
      <BillSectionDialog
        open={billOpen}
        onOpenChange={setBillOpen}
        sections={sections}
        onDone={() => router.refresh()}
      />

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this amount?</DialogTitle>
            <DialogDescription>
              {confirmDelete &&
                `${confirmDelete.feeHead} · ${confirmDelete.classLevel} · ${formatMoney(confirmDelete.amount)}`}
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertTitle>Invoices already raised are not affected</AlertTitle>
            <AlertDescription>
              This only changes what future invoices include. Bills already issued keep their lines,
              because an issued invoice is a record of what was charged.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                const result = await deleteFeeStructure(confirmDelete.id);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Amount removed");
                setConfirmDelete(null);
                router.refresh();
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeeHeadDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FeeHeadInput>({
    resolver: zodResolver(feeHeadSchema),
    defaultValues: { code: "", name: "", description: "", category: "tuition", isActive: true },
  });

  async function onSubmit(values: FeeHeadInput) {
    setServerError(null);
    const result = await saveFeeHead(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Fee head added");
    onOpenChange(false);
    form.reset();
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a fee head</DialogTitle>
          <DialogDescription>Something the school charges for.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not saved</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="code"
                label="Code"
                required
                placeholder="TUITION"
                description="Short and stable — it appears on reports"
              />
              <SelectField
                control={form.control}
                name="category"
                label="Category"
                required
                options={FEE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
              />
            </div>
            <TextField control={form.control} name="name" label="Name" required placeholder="Tuition fee" />
            <TextareaField control={form.control} name="description" label="Description" />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Add fee head
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function FeeStructureDialog({
  open,
  onOpenChange,
  classLevels,
  feeHeads,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classLevels: { id: string; name: string }[];
  feeHeads: FeeHead[];
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FeeStructureInput>({
    resolver: zodResolver(feeStructureSchema),
    defaultValues: { classLevelId: "", feeHeadId: "", amount: undefined, frequency: "annual" },
  });

  async function onSubmit(values: FeeStructureInput) {
    setServerError(null);
    const result = await saveFeeStructure(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success("Amount set");
    onOpenChange(false);
    form.reset();
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set a class amount</DialogTitle>
          <DialogDescription>
            What one class pays for one head, this session.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Not saved</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="classLevelId"
                label="Class"
                required
                options={classLevels.map((c) => ({ value: c.id, label: c.name }))}
              />
              <SelectField
                control={form.control}
                name="feeHeadId"
                label="Fee head"
                required
                options={feeHeads.map((h) => ({ value: h.id, label: h.name }))}
              />
              <TextField control={form.control} name="amount" label="Amount" type="number" required />
              <SelectField
                control={form.control}
                name="frequency"
                label="Frequency"
                required
                options={FEE_FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
                description="How often this instalment is billed"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Set amount
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function BillSectionDialog({
  open,
  onOpenChange,
  sections,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: { id: string; label: string }[];
  onDone: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<{ sectionId: string; dueDate: string }>({
    resolver: zodResolver(generateSectionInvoicesSchema),
    defaultValues: { sectionId: "", dueDate: todayPlus(30) },
  });

  async function onSubmit(values: { sectionId: string; dueDate: string }) {
    setServerError(null);
    const result = await generateSectionInvoices(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    toast.success(
      result.data.created === 0
        ? "Every student in that class already had an invoice for that date"
        : `${result.data.created} ${result.data.created === 1 ? "invoice" : "invoices"} raised`,
    );
    onOpenChange(false);
    form.reset({ sectionId: "", dueDate: todayPlus(30) });
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise invoices for a class</DialogTitle>
          <DialogDescription>
            Bills every enrolled student in the class at that class&apos;s set amounts.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>Nothing raised</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
            <SelectField
              control={form.control}
              name="sectionId"
              label="Class"
              required
              options={sections.map((s) => ({ value: s.id, label: s.label }))}
            />
            <TextField control={form.control} name="dueDate" label="Due date" type="date" required />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Raise invoices
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}


/**
 * Two switches an administrator owns: whether families can be asked to pay
 * online, and where invoice emails go. Both are off until someone deliberately
 * turns them on — a migration never enables either.
 */
function IntegrationSettings({
  settings,
  onDone,
}: {
  settings: FeeIntegrationSettings;
  onDone: () => void;
}) {
  const [online, setOnline] = useState(settings.onlinePaymentsEnabled);
  const [emailOn, setEmailOn] = useState(settings.invoiceEmailEnabled);
  const [to, setTo] = useState(settings.invoiceEmailTo ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    online !== settings.onlinePaymentsEnabled ||
    emailOn !== settings.invoiceEmailEnabled ||
    to !== (settings.invoiceEmailTo ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveFeeIntegrationSettings({
      onlinePaymentsEnabled: online,
      invoiceEmailEnabled: emailOn,
      invoiceEmailTo: to,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Settings saved");
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-4" aria-hidden="true" />
            Online payments
          </CardTitle>
          <CardDescription>
            Lets the counter create a Razorpay payment link a family can pay from their phone. The
            payment lands in the ledger with its own receipt number, exactly like cash.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Switch id="online-payments" checked={online} onCheckedChange={setOnline} />
            <Label htmlFor="online-payments" className="font-normal">
              Allow payment links
            </Label>
          </div>
          <Alert>
            <AlertTitle>Keys are set outside this screen</AlertTitle>
            <AlertDescription>
              Razorpay credentials live on the Supabase Edge Functions as{" "}
              <code className="font-mono text-xs">RAZORPAY_KEY_ID</code>,{" "}
              <code className="font-mono text-xs">RAZORPAY_KEY_SECRET</code> and{" "}
              <code className="font-mono text-xs">RAZORPAY_WEBHOOK_SECRET</code> — never in this
              application, so they cannot reach a browser. Until they are set, creating a link
              fails with a clear message and nothing is charged.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4" aria-hidden="true" />
            Invoice email
          </CardTitle>
          <CardDescription>
            One address for this school. Invoices you choose to send are queued for it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Switch id="invoice-email" checked={emailOn} onCheckedChange={setEmailOn} />
            <Label htmlFor="invoice-email" className="font-normal">
              Queue invoices for email
            </Label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-email-to">Send invoices to</Label>
            <Input
              id="invoice-email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="accounts@school.example"
              className="max-w-sm"
            />
          </div>
          <Alert>
            <AlertTitle>Queued, not sent</AlertTitle>
            <AlertDescription>
              No mail provider is connected yet, so queued invoices wait in the jobs table and
              nothing reaches an inbox. This is deliberate — turning it on here does not start
              sending mail to anybody.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Save settings
        </Button>
      </div>
    </div>
  );
}


export type SchoolProfile = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
  website: string;
};

/**
 * The letterhead. `tenants` holds only a name, and a fee invoice with no
 * address or contact on it is not something a school can hand to a parent —
 * so this is what turns the printed bill into a document.
 */
function SchoolProfileCard({
  profile,
  onDone,
}: {
  profile: SchoolProfile;
  onDone: () => void;
}) {
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = (Object.keys(profile) as (keyof SchoolProfile)[]).some(
    (k) => form[k] !== profile[k],
  );

  function field(key: keyof SchoolProfile, label: string, type = "text") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`school-${key}`}>{label}</Label>
        <Input
          id={`school-${key}`}
          type={type}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4" aria-hidden="true" />
          School details on invoices
        </CardTitle>
        <CardDescription>
          Printed at the top of every fee invoice. A bill with no address on it is not one a family
          can act on.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Not saved</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {field("addressLine1", "Address line 1")}
          {field("addressLine2", "Address line 2")}
          {field("city", "City")}
          {field("state", "State")}
          {field("postalCode", "PIN code")}
          {field("phone", "Phone", "tel")}
          {field("email", "Email", "email")}
          {field("website", "Website", "url")}
        </div>

        <div>
          <Button
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              const result = await saveSchoolProfile(form);
              setSaving(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              toast.success("School details saved");
              onDone();
            }}
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Save school details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
