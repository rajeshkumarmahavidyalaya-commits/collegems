"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  BookOpenCheck,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
} from "lucide-react";
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
  ACCOUNT_TYPES,
  accountSchema,
  accountTypeLabel,
  formatAmount,
  formatBalance,
  formatColumn,
  type AccountInput,
} from "@/lib/validations/accounts";
import {
  saveAccount,
  syncSubledgers,
  type ChartRow,
  type PostingRuleRow,
  type TrialBalanceRow,
} from "./actions";

type Props = {
  chart: ChartRow[];
  trialBalance: TrialBalanceRow[];
  rules: PostingRuleRow[];
  unposted: number;
  canManage: boolean;
  canPost: boolean;
};

export function ChartView({
  chart,
  trialBalance,
  rules,
  unposted,
  canManage,
  canPost,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChartRow | null>(null);

  return (
    <Tabs defaultValue="chart">
      <TabsList>
        <TabsTrigger value="chart">Chart of accounts</TabsTrigger>
        <TabsTrigger value="trial">Trial balance</TabsTrigger>
        <TabsTrigger value="rules">Posting rules</TabsTrigger>
      </TabsList>

      <TabsContent value="chart" className="mt-4 flex flex-col gap-4">
        {canPost && <SyncBanner unposted={unposted} />}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Chart of accounts</CardTitle>
              <CardDescription className="max-w-2xl">
                A heading totals what sits under it; only a postable account can take an entry —
                the database refuses a line against a heading, so a total can never double-count
                itself.
              </CardDescription>
            </div>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                New account
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {chart.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center">
                <span className="rounded-full bg-muted p-3">
                  <Landmark className="size-6 text-muted-foreground" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-medium">No chart of accounts</p>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    A standard chart is seeded for every school. If this is empty, nothing can be
                    posted yet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      {canManage && <TableHead className="w-14 text-right" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chart.map((row) => (
                      <TableRow key={row.id} className={row.isPostable ? undefined : "bg-muted/30"}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {row.code}
                        </TableCell>
                        <TableCell>
                          <span
                            className={row.isPostable ? "" : "font-medium"}
                            style={{ paddingLeft: `${row.depth * 1.25}rem` }}
                          >
                            {row.isPostable ? (
                              <Link
                                href={`/accounts/${row.id}`}
                                className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {row.name}
                              </Link>
                            ) : (
                              row.name
                            )}
                          </span>
                          <span className="ml-2 inline-flex gap-1">
                            {!row.isPostable && (
                              <Badge variant="outline" className="text-[10px]">
                                Heading
                              </Badge>
                            )}
                            {!row.isActive && (
                              <Badge variant="outline" className="text-[10px]">
                                Inactive
                              </Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {accountTypeLabel(row.accountType)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatBalance(row.balance)}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditing(row);
                                setOpen(true);
                              }}
                              aria-label={`Edit ${row.name}`}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
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
      </TabsContent>

      <TabsContent value="trial" className="mt-4">
        <TrialBalance rows={trialBalance} />
      </TabsContent>

      <TabsContent value="rules" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Posting rules</CardTitle>
            <CardDescription className="max-w-2xl">
              Which accounts a source event moves. Rules rather than code, because &ldquo;a fee
              receipt debits Bank and credits Fee Income&rdquo; is one school&apos;s arrangement —
              the next splits fee income by class, and that should be a row, not a release.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Debit</TableHead>
                    <TableHead>Credit</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono text-xs">{rule.eventKey}</TableCell>
                      <TableCell>{rule.debitAccount}</TableCell>
                      <TableCell>{rule.creditAccount}</TableCell>
                      <TableCell>
                        <Badge variant={rule.isActive ? "default" : "outline"}>
                          {rule.isActive ? "Active" : "Off"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Cash basis: income and expense are recognised when money moves, so only fee receipts,
              refunds and salary payments post. Discounts, fines and write-offs stay in the fee
              subledger.
            </p>
          </CardContent>
        </Card>
      </TabsContent>

      <AccountDialog open={open} onOpenChange={setOpen} account={editing} chart={chart} />
    </Tabs>
  );
}

function SyncBanner({ unposted }: { unposted: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const result = await syncSubledgers(200);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { created, remaining } = result.data;
      toast.success(
        created === 0
          ? "Everything is already posted."
          : `Posted ${created} ${created === 1 ? "voucher" : "vouchers"}.${
              remaining > 0 ? ` ${remaining} still to go — run it again.` : ""
            }`,
      );
      router.refresh();
    });
  }

  if (unposted === 0) {
    return (
      <p className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <BookOpenCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Every fee receipt and salary payment is posted to the ledger.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-accent/40 p-4">
      <p className="flex items-start gap-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-accent" aria-hidden="true" />
        <span>
          <span className="font-medium">
            {unposted} {unposted === 1 ? "document is" : "documents are"} not in the ledger yet.
          </span>{" "}
          Fee receipts and salary payments post through the rules below. It is safe to run more than
          once — each document posts exactly once.
        </span>
      </p>
      <Button size="sm" disabled={pending} onClick={sync}>
        <RefreshCw className="size-4" aria-hidden="true" />
        {pending ? "Posting…" : "Post to the ledger"}
      </Button>
    </div>
  );
}

function TrialBalance({ rows }: { rows: TrialBalanceRow[] }) {
  const totals = useMemo(
    () => ({
      debit: rows.reduce((s, r) => s + r.debit, 0),
      credit: rows.reduce((s, r) => s + r.credit, 0),
    }),
    [rows],
  );
  const ties = Math.abs(totals.debit - totals.credit) < 0.005;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trial balance</CardTitle>
        <CardDescription>
          Every account with a balance. The two columns are equal by construction — each voucher
          balanced before it could post — which is what makes this worth handing an auditor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Scale className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nothing posted yet</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Post the fee receipts and salary payments to the ledger, or write a journal, and the
                trial balance appears here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.accountId}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.code}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/accounts/${row.accountId}`}
                        className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {accountTypeLabel(row.accountType)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatColumn(row.debit)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatColumn(row.credit)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-medium">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatAmount(totals.debit)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatAmount(totals.credit)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 && (
          <p
            className="mt-3 text-sm"
            aria-live="polite"
          >
            {ties ? (
              <span className="text-muted-foreground">
                The books tie: debits and credits both come to {formatAmount(totals.debit)}.
              </span>
            ) : (
              <span className="font-medium text-destructive">
                The books do not tie — out by {formatAmount(Math.abs(totals.debit - totals.credit))}.
                That should be impossible; please report it.
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AccountDialog({
  open,
  onOpenChange,
  account,
  chart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: ChartRow | null;
  chart: ChartRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<AccountInput>({
    resolver: zodResolver(accountSchema),
    values: {
      code: account?.code ?? "",
      name: account?.name ?? "",
      accountType: (account?.accountType ?? "asset") as AccountInput["accountType"],
      parentId: account?.parentId ?? "",
      isPostable: account?.isPostable ?? true,
      isActive: account?.isActive ?? true,
      description: "",
    },
  });

  const isPostable = form.watch("isPostable");
  const isActive = form.watch("isActive");
  const accountType = form.watch("accountType");

  // Only headings of the same type can be a parent: a bank account under
  // "Income" would roll a debit balance into a credit total.
  const parents = useMemo(
    () =>
      chart
        .filter((a) => !a.isPostable && a.accountType === accountType && a.id !== account?.id)
        .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    [chart, accountType, account?.id],
  );

  function onSubmit(input: AccountInput) {
    startTransition(async () => {
      const result = await saveAccount(input, account?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof AccountInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }
      toast.success(account ? "Account updated." : "Account created.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle>
          <DialogDescription>
            The type decides which way a balance reads and which total it rolls into, so it is not
            free text.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="code" label="Code" required />
              <SelectField
                control={form.control}
                name="accountType"
                label="Type"
                required
                options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>

            <TextField control={form.control} name="name" label="Name" required />

            <SelectField
              control={form.control}
              name="parentId"
              label="Sits under"
              options={parents}
              placeholder={parents.length ? "Top level" : "No heading of this type yet"}
              description="Only a heading of the same type can be a parent."
            />

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="account-postable" className="text-sm font-medium">
                  Entries can be posted here
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off makes this a heading that totals its children. A heading cannot take an
                  entry — the database refuses it.
                </p>
              </div>
              <Switch
                id="account-postable"
                checked={isPostable}
                onCheckedChange={(v) => form.setValue("isPostable", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <Label htmlFor="account-active" className="text-sm font-medium">
                Active
              </Label>
              <Switch
                id="account-active"
                checked={isActive}
                onCheckedChange={(v) => form.setValue("isActive", v)}
              />
            </div>

            <TextareaField control={form.control} name="description" label="Note" rows={2} />

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
