import Link from "next/link";
import { HandCoins, List, Plus, Receipt, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { formatCurrency, formatDate, formatNumber } from "@/lib/i18n/format";
import { getChart, listCashEntries } from "./actions";
import { ExportRowsButton } from "@/components/export-rows-button";
import { CashCategoryForm, CashEntryForm, ReverseCashEntry } from "./cash-book";
import { CASH_WORDS } from "./cash-words";

type Kind = "expense" | "income";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The reference's Expenses and Donation screens over this product's books.
 * An expense is a posted voucher on an expense account and a donation one on
 * an income account; a "category" is that account. So every screen here reads
 * and writes the general ledger through the accounts module's own functions,
 * and is gated on the permissions the ledger's policies check (rule 4):
 * `accounts.view` to read, `accounts.post` to record, `accounts.manage` to add
 * a category to the chart.
 */
function NoAccess({ kind }: { kind: Kind }) {
  const words = CASH_WORDS[kind];
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={words.list} icon={kind === "expense" ? Receipt : HandCoins} />
      <p className="max-w-2xl text-sm text-muted-foreground">
        {words.many.charAt(0).toUpperCase() + words.many.slice(1)} are kept in the school&apos;s books,
        which the office and the accountant read. Ask an administrator for <code>accounts.view</code>{" "}
        if you need them.
      </p>
    </div>
  );
}

async function schoolToday(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("mobile_today");
  return typeof data === "string" && ISO.test(data) ? data : new Date().toISOString().slice(0, 10);
}

async function categoriesFor(kind: Kind) {
  const chart = await getChart();
  const open = chart.filter((a) => a.isPostable && a.isActive);
  return {
    categories: open.filter((a) => a.accountType === kind).map((a) => ({ id: a.id, label: a.name, code: a.code })),
    moneyAccounts: open
      .filter((a) => a.accountType === "asset" && /cash|bank/i.test(a.name))
      .map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` })),
  };
}

export async function CashListPage({
  kind,
  searchParams,
}: {
  kind: Kind;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const words = CASH_WORDS[kind];
  const [canView, canPost, params, locale] = await Promise.all([
    hasPermission("accounts.view"),
    hasPermission("accounts.post"),
    searchParams,
    getLocale(),
  ]);
  if (!canView) return <NoAccess kind={kind} />;

  const from = params.from && ISO.test(params.from) ? params.from : null;
  const to = params.to && ISO.test(params.to) ? params.to : null;
  const { rows, capped, limit } = await listCashEntries(kind, from, to);
  // A reversed entry stays listed with its cancellation, and is not counted.
  const total = rows.filter((r) => !r.reversed).reduce((sum, r) => sum + r.amount, 0);
  const dash = "—";

  const exportRows = [
    ["Title", "Category", words.party, "Amount", "Invoice Number", "Date", "Note", "Voucher", "Reversed"],
    ...rows.map((r) => [
      r.title,
      r.category,
      r.partyName ?? "",
      r.amount.toFixed(2),
      r.invoiceNumber ?? "",
      r.date,
      r.note ?? "",
      r.voucherNumber,
      r.reversed ? "yes" : "",
    ]),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={words.list} icon={kind === "expense" ? Receipt : HandCoins}>
        <Button asChild variant="outline">
          <Link href={`${words.listHref}/categories`}>
            <Tags className="size-4" aria-hidden="true" />
            {words.categories}
          </Link>
        </Button>
        {canPost && (
          <Button asChild>
            <Link href={`${words.listHref}/new`}>
              <Plus className="size-4" aria-hidden="true" />
              {words.add}
            </Link>
          </Button>
        )}
      </PageToolbar>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4" aria-label={`Filter ${words.many} by date`}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-from`}>Start Date</Label>
          <Input id={`${kind}-from`} name="from" type="date" defaultValue={from ?? ""} className="w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${kind}-to`}>End Date</Label>
          <Input id={`${kind}-to`} name="to" type="date" defaultValue={to ?? ""} className="w-44" />
        </div>
        <Button type="submit" className="cursor-pointer">
          Fetch
        </Button>
        {(from || to) && (
          <Button asChild variant="ghost">
            <Link href={words.listHref}>Clear</Link>
          </Button>
        )}
        <div className="ms-auto flex items-end gap-3">
          <p className="text-sm">
            Total: <span className="font-semibold tabular-nums">{formatCurrency(total, locale)}</span>
          </p>
          <ExportRowsButton rows={exportRows} fileName={`${kind === "expense" ? "expenses" : "donations"}.csv`} />
        </div>
      </form>

      {capped && (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the newest {formatNumber(limit, locale)} entries; there are more. Narrow the dates to see the rest.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-6 py-10 text-center">
          <p className="font-medium">No {words.many} recorded{from || to ? " in these dates" : ""}.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {canPost
              ? `Use ${words.add} to record one; it is posted to the books as a voucher.`
              : "The office records them here as they happen."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>{words.party}</TableHead>
                <TableHead className="text-end">Amount</TableHead>
                <TableHead>Invoice Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.voucherId}>
                  <TableCell>
                    <span className={r.reversed ? "line-through" : undefined}>{r.title}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{r.voucherNumber}</span>
                  </TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell>{r.partyName ?? dash}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(r.amount, locale)}</TableCell>
                  <TableCell>{r.invoiceNumber ?? dash}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date, locale)}</TableCell>
                  <TableCell className="max-w-64 truncate" title={r.note ?? undefined}>
                    {r.note ?? dash}
                  </TableCell>
                  <TableCell>
                    {r.reversed ? (
                      <Badge variant="secondary">Reversed</Badge>
                    ) : canPost ? (
                      <ReverseCashEntry voucherId={r.voucherId} voucherNumber={r.voucherNumber} title={r.title} />
                    ) : (
                      dash
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums">{formatCurrency(total, locale)}</TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}

export async function CashNewPage({ kind }: { kind: Kind }) {
  const words = CASH_WORDS[kind];
  const [canView, canPost] = await Promise.all([hasPermission("accounts.view"), hasPermission("accounts.post")]);
  if (!canView) return <NoAccess kind={kind} />;

  const toolbar = (
    <PageToolbar title={words.add} icon={kind === "expense" ? Receipt : HandCoins}>
      <Button asChild variant="outline">
        <Link href={words.listHref}>
          <List className="size-4" aria-hidden="true" />
          View All
        </Link>
      </Button>
    </PageToolbar>
  );
  if (!canPost) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <p className="max-w-2xl text-sm text-muted-foreground">
          Recording money in the books needs <code>accounts.post</code>, which your role does not hold.
        </p>
      </div>
    );
  }

  const [{ categories, moneyAccounts }, today] = await Promise.all([categoriesFor(kind), schoolToday()]);
  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      {moneyAccounts.length === 0 ? (
        <p className="max-w-2xl text-sm text-muted-foreground">
          The chart of accounts has no open cash or bank account for the money to {kind === "expense" ? "leave from" : "go into"}.
          Add one under <Link href="/accounts" className="underline">Accounts</Link> first.
        </p>
      ) : (
        <CashEntryForm
          kind={kind}
          categories={categories.map((c) => ({ id: c.id, label: c.label }))}
          moneyAccounts={moneyAccounts}
          today={today}
        />
      )}
    </div>
  );
}

export async function CashCategoriesPage({ kind }: { kind: Kind }) {
  const words = CASH_WORDS[kind];
  const [canView, canManage] = await Promise.all([hasPermission("accounts.view"), hasPermission("accounts.manage")]);
  if (!canView) return <NoAccess kind={kind} />;
  const { categories } = await categoriesFor(kind);

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={words.categories} icon={Tags}>
        <Button asChild variant="outline">
          <Link href={words.listHref}>
            <List className="size-4" aria-hidden="true" />
            {words.viewAll}
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Each category is an {kind} account in the chart of accounts, so the trial balance totals by
        it. Renaming or closing one is done under <Link href="/accounts" className="underline">Accounts</Link>.
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        {categories.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
            No open {kind} accounts yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Account code</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.label}</TableCell>
                    <TableCell className="font-mono text-xs">{c.code}</TableCell>
                    <TableCell>
                      <Link href={`/accounts/${c.id}`} className="text-sm underline-offset-2 hover:underline">
                        Ledger
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {canManage ? (
          <CashCategoryForm kind={kind} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Adding a category changes the chart of accounts, which needs <code>accounts.manage</code>.
          </p>
        )}
      </div>
    </div>
  );
}
