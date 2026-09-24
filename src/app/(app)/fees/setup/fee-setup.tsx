"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  Building2,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  Plus,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

import { useI18n } from "@/components/providers/i18n-provider";

import {
  deleteFeeStructure,
  saveFeeIntegrationSettings,
  saveSchoolProfile,
  type FeeIntegrationSettings,
  type FeeCopySource,
} from "../actions";
import { copyFeeStructures } from "../../academics/sessions/actions";
import type { TypedStudent } from "./student-type-actions";
import type { FeeStructureDraft } from "./fee-setup-dialogs";
import {
  byClass,
  effectiveFees,
  effectiveTotal,
  type EffectiveFee,
  type FeeRow,
  type StudentTypeOption,
} from "@/lib/validations/student-types";
import { frequencyOptions } from "@/lib/validations/fees-display";
import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const FeeHeadDialog = dynamic(() =>
  import("./fee-setup-dialogs").then((m) => m.FeeHeadDialog),
);
const FeeStructureDialog = dynamic(() =>
  import("./fee-setup-dialogs").then((m) => m.FeeStructureDialog),
);
// A tab behind a click, holding the student search (Popover and Command).
const StudentTypesPanel = dynamic(() =>
  import("./student-types-panel").then((m) => m.StudentTypesPanel),
);
const BillSectionDialog = dynamic(() =>
  import("./fee-setup-dialogs").then((m) => m.BillSectionDialog),
);

export type FeeHead = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
};


export function FeeSetup({
  feeHeads,
  structures,
  classLevels,
  sections,
  integrations,
  schoolProfile,
  canManageSettings,
  copySource,
  studentTypes,
  typedStudents,
  sessionName,
}: {
  feeHeads: FeeHead[];
  structures: FeeRow[];
  studentTypes: StudentTypeOption[];
  typedStudents: TypedStudent[];
  sessionName: string;
  classLevels: { id: string; name: string }[];
  sections: { id: string; label: string }[];
  integrations: FeeIntegrationSettings;
  schoolProfile: SchoolProfile;
  canManageSettings: boolean;
  /** Set when this year has no fees and an earlier year does (0276). */
  copySource: FeeCopySource | null;
}) {
  const { formatCurrency } = useI18n();
  const [copying, startCopy] = useTransition();

  function copyLastYear() {
    if (!copySource) return;
    startCopy(async () => {
      const r = await copyFeeStructures(copySource.fromId, copySource.toId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(
        `Copied ${r.data.created} ${r.data.created === 1 ? "fee" : "fees"} from ${copySource.fromName}. Check the amounts before raising invoices.`,
      );
      router.refresh();
    });
  }
  const router = useRouter();
  const [headOpen, setHeadOpen] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [draft, setDraft] = useState<FeeStructureDraft | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FeeRow | null>(null);

  function openFee(fee: EffectiveFee, viewing: StudentTypeOption | null) {
    const row = fee.row;
    const override = fee.kind === "inherited" && viewing !== null;
    setDraft({
      classLevelId: row.classLevelId,
      classLevel: row.classLevel,
      feeHeadId: row.feeHeadId,
      feeHead: row.feeHead,
      studentTypeId: override ? viewing.id : row.studentTypeId,
      studentType: override ? viewing.name : row.studentType,
      amount: row.amount,
      frequency: row.frequency as FeeStructureDraft["frequency"],
      mode: override ? "override" : "edit",
    });
    setStructureOpen(true);
  }

  const activeHeads = feeHeads.filter((h) => h.is_active);


  return (
    <div className="flex flex-col gap-6">
      {copySource && (
        <Alert>
          <AlertTitle>This year has no fees yet</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            Nothing would be billed until each class has amounts. {copySource.fromName} had{" "}
            {copySource.count} {copySource.count === 1 ? "fee" : "fees"}; copy them across as a
            starting point and change what has gone up.
            <Button size="sm" variant="outline" onClick={copyLastYear} disabled={copying}>
              {copying && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Copy {copySource.fromName}&rsquo;s fees
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="structures">
        <TabsList>
          <TabsTrigger value="structures">Fees by class</TabsTrigger>
          <TabsTrigger value="types">Student types ({studentTypes.length})</TabsTrigger>
          <TabsTrigger value="heads">Fee heads ({feeHeads.length})</TabsTrigger>
          <TabsTrigger value="billing">Raise invoices</TabsTrigger>
          {canManageSettings && (
            <TabsTrigger value="integrations">Payments &amp; email</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="structures" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-prose text-sm text-muted-foreground">
              What each class pays in {sessionName}. Click a fee to change it. A
              carry-over or other kind of student can have its own amount for any
              fee, and pays the regular amount for the rest.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setDraft(null);
                setStructureOpen(true);
              }}
              disabled={activeHeads.length === 0}
            >
              <Plus className="size-4" aria-hidden="true" />
              Set a fee
            </Button>
          </div>

          {activeHeads.length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>Add a fee head first</AlertTitle>
              <AlertDescription>
                A fee head is what you charge for — tuition, transport, exam
                fees. Amounts are set per class against a head.
              </AlertDescription>
            </Alert>
          ) : structures.length === 0 ? (
            <Alert>
              <FileText className="size-4" aria-hidden="true" />
              <AlertTitle>No fees set yet</AlertTitle>
              <AlertDescription>
                Until a class has fees against it, invoices for that class
                cannot be raised.
              </AlertDescription>
            </Alert>
          ) : (
            <ClassFees
              rows={structures}
              studentTypes={studentTypes}
              onEdit={openFee}
              onDelete={setConfirmDelete}
            />
          )}
        </TabsContent>

        <TabsContent value="types" className="mt-4">
          <StudentTypesPanel
            types={studentTypes}
            typedStudents={typedStudents}
            sessionName={sessionName}
            sections={sections}
          />
        </TabsContent>

        <TabsContent value="heads" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              What the school charges for. A head is never deleted once it has
              been billed — mark it inactive instead, and it stops appearing on
              new invoices.
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
                Start with the ones every school has: tuition, exam fee,
                transport.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 py-2 text-start font-medium"
                    >
                      Code
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-start font-medium"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-start font-medium"
                    >
                      Category
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-start font-medium"
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {feeHeads.map((head) => (
                    <tr key={head.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">
                        {head.code}
                      </td>
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
            Raising invoices for a class bills every enrolled student at that
            class&apos;s set amounts. Students who already have an invoice for
            that due date are skipped, so running it twice tops up rather than
            double-billing.
          </p>
          <div>
            <Button
              onClick={() => setBillOpen(true)}
              disabled={structures.length === 0}
            >
              <FileText className="size-4" aria-hidden="true" />
              Raise invoices for a class
            </Button>
          </div>
          {structures.length === 0 && (
            <Alert>
              <AlertTitle>Set class amounts first</AlertTitle>
              <AlertDescription>
                There is nothing to bill until at least one class has amounts
                against it.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {canManageSettings && (
          <TabsContent value="integrations" className="mt-4">
            <div className="flex flex-col gap-4">
              <SchoolProfileCard
                profile={schoolProfile}
                onDone={() => router.refresh()}
              />
              <IntegrationSettings
                settings={integrations}
                onDone={() => router.refresh()}
              />
            </div>
          </TabsContent>
        )}
      </Tabs>

      {headOpen ? (
        <FeeHeadDialog
          open={headOpen}
          onOpenChange={setHeadOpen}
          onDone={() => router.refresh()}
        />
      ) : null}
      {structureOpen ? (
        <FeeStructureDialog
          open={structureOpen}
          onOpenChange={(open) => {
            setStructureOpen(open);
            if (!open) setDraft(null);
          }}
          classLevels={classLevels}
          feeHeads={activeHeads}
          studentTypes={studentTypes}
          sessionName={sessionName}
          initial={draft}
          onDone={() => router.refresh()}
        />
      ) : null}
      {billOpen ? (
        <BillSectionDialog
          open={billOpen}
          onOpenChange={setBillOpen}
          sections={sections}
          onDone={() => router.refresh()}
        />
      ) : null}

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this fee?</DialogTitle>
            <DialogDescription>
              {confirmDelete &&
                `${confirmDelete.feeHead} · ${confirmDelete.classLevel} · ${confirmDelete.studentType ? `${confirmDelete.studentType} students` : "every student"} · ${formatCurrency(confirmDelete.amount)}`}
            </DialogDescription>
          </DialogHeader>
          {confirmDelete?.studentTypeId && (
            <p className="text-sm">
              {confirmDelete.studentType} students in {confirmDelete.classLevel} will pay the
              regular {confirmDelete.feeHead} again.
            </p>
          )}
          <Alert>
            <AlertTitle>Invoices already raised are not affected</AlertTitle>
            <AlertDescription>
              This only changes what future invoices include. Bills already
              issued keep their lines, because an issued invoice is a record of
              what was charged.
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
                toast.success("Fee removed");
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

/**
 * What each class pays, as one kind of student pays it (0281).
 *
 * The switch at the top is the point: "what does a carry-over student in
 * Grade 6 pay" used to need somebody to read two rows and subtract. Each card
 * resolves it with `effectiveFees`, the screen's copy of the rule
 * `fees_billable_lines` bills by, and marks every line with where its amount
 * came from -- the type's own, the regular one it inherits, or an exemption.
 */
function ClassFees({
  rows,
  studentTypes,
  onEdit,
  onDelete,
}: {
  rows: FeeRow[];
  studentTypes: StudentTypeOption[];
  onEdit: (fee: EffectiveFee, viewing: StudentTypeOption | null) => void;
  onDelete: (row: FeeRow) => void;
}) {
  const { t, formatCurrency } = useI18n();
  const [viewing, setViewing] = useState<string | null>(null);
  const periods = frequencyOptions(t);
  const periodOf = (v: string) => periods.find((p) => p.value === v)?.label ?? v;
  const viewingType = studentTypes.find((s) => s.id === viewing) ?? null;
  const classes = byClass(rows);
  const ownCount = (typeId: string) => rows.filter((r) => r.studentTypeId === typeId).length;

  return (
    <div className="flex flex-col gap-4">
      {studentTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p id="viewing-label" className="text-xs font-medium text-muted-foreground">
            Showing fees for
          </p>
          <div
            role="group"
            aria-labelledby="viewing-label"
            className="flex flex-wrap gap-2"
          >
            {[{ id: null, name: "Regular students", count: null as number | null }, ...studentTypes.map((s) => ({ id: s.id, name: `${s.name} students`, count: ownCount(s.id) }))].map((option) => {
              const active = viewing === option.id;
              return (
                <Button
                  key={option.id ?? "regular"}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
                  onClick={() => setViewing(option.id)}
                >
                  {option.name}
                  {option.count !== null && (
                    <span className="rounded-full bg-background/20 px-1.5 font-mono text-xs tabular-nums">
                      {option.count}
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
          {viewingType && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {viewingType.name} students pay their own amount where one is set, and the regular
              amount everywhere else.
              {ownCount(viewingType.id) === 0 &&
                ` No ${viewingType.name} amounts are set yet, so they pay exactly what regular students pay.`}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {classes.map((group) => {
          const fees = effectiveFees(group.rows, viewing);
          const total = effectiveTotal(fees);
          return (
            <Card key={group.classLevelId} className="overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/30 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{group.classLevel}</CardTitle>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {formatCurrency(total)}
                  </span>
                </div>
                <CardDescription>
                  {viewingType ? `As a ${viewingType.name} student` : "As a regular student"} ·
                  one of each period
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3">
                {fees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No fees set for this class.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {fees.map((fee) => (
                      <li
                        key={`${fee.row.id}-${fee.kind}`}
                        className="flex items-center justify-between gap-2 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => onEdit(fee, viewingType)}
                          className="min-w-0 flex-1 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={
                            fee.kind === "inherited" && viewingType
                              ? `Set a ${viewingType.name} amount for ${fee.row.feeHead} in ${group.classLevel}`
                              : `Change ${fee.row.feeHead} for ${group.classLevel}${fee.row.studentType ? `, ${fee.row.studentType} students` : ""}`
                          }
                        >
                          <span className="block truncate font-medium">{fee.row.feeHead}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {periodOf(fee.row.frequency)}
                            {fee.kind === "own" && (
                              <Badge variant="warning">{fee.row.studentType} rate</Badge>
                            )}
                            {fee.kind === "exempt" && <Badge variant="outline">Exempt</Badge>}
                            {fee.kind === "inherited" && <span>· same as regular</span>}
                          </span>
                        </button>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="text-end">
                            <span
                              className={
                                fee.kind === "exempt"
                                  ? "block font-mono text-muted-foreground tabular-nums"
                                  : "block font-mono tabular-nums"
                              }
                            >
                              {fee.kind === "exempt" ? formatCurrency(0) : formatCurrency(fee.row.amount)}
                            </span>
                            {fee.regularAmount !== null && (
                              <span className="block font-mono text-xs text-muted-foreground tabular-nums">
                                <span className="sr-only">Regular amount </span>
                                <s>{formatCurrency(fee.regularAmount)}</s>
                              </span>
                            )}
                          </span>
                          {fee.kind !== "inherited" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${fee.row.feeHead} from ${group.classLevel}${fee.row.studentType ? ` for ${fee.row.studentType} students` : ""}`}
                              onClick={() => onDelete(fee.row)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
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
            Lets the counter create a Razorpay payment link a family can pay
            from their phone. The payment lands in the ledger with its own
            receipt number, exactly like cash.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="online-payments"
              checked={online}
              onCheckedChange={setOnline}
            />
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
              <code className="font-mono text-xs">RAZORPAY_WEBHOOK_SECRET</code>{" "}
              — never in this application, so they cannot reach a browser. Until
              they are set, creating a link fails with a clear message and
              nothing is charged.
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
            One address for this school. Invoices you choose to send are queued
            for it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="invoice-email"
              checked={emailOn}
              onCheckedChange={setEmailOn}
            />
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
              No mail provider is connected yet, so queued invoices wait in the
              jobs table and nothing reaches an inbox. This is deliberate —
              turning it on here does not start sending mail to anybody.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
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
          Printed at the top of every fee invoice. A bill with no address on it
          is not one a family can act on.
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
            {saving && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Save school details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
