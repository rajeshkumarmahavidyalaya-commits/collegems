import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  countUnposted,
  getChart,
  getTrialBalance,
  listPostingRules,
  listYearCloses,
} from "./actions";
import { YearEndCard } from "./year-end";
import { ChartView } from "./chart-view";
import { ModuleCards } from "@/components/module-cards";
import { CashEntryButton } from "./cash-entry-dialog";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const [ctx, canView, canManage, canPost] = await Promise.all([
    getUserContext(),
    hasPermission("accounts.view"),
    hasPermission("accounts.manage"),
    hasPermission("accounts.post"),
  ]);

  // RLS already restricts every accounts table to finance roles, so a teacher
  // reaching this URL sees empty lists rather than an error. Saying so plainly
  // is better than rendering blank tables.
  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The school&apos;s books are visible to the office and the accountant. If you need the
            trial balance, ask an administrator to grant you <code>accounts.view</code>.
          </p>
        </div>
      </div>
    );
  }

  const [chart, trialBalance, rules, unposted, closes] = await Promise.all([
    getChart(),
    getTrialBalance(),
    listPostingRules(),
    countUnposted(),
    listYearCloses(),
  ]);

  // The last 31 March on or before today: an Indian financial year's end,
  // and only a suggestion -- the date is the person's to change.
  const today = new Date();
  const fyEndYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const suggestedClose = `${fyEndYear}-03-31`;

  // The expense and income forms' pick lists, from the chart already read:
  // postable, open accounts of the right type, and the cash and bank accounts
  // money moves through. accounts_record_cash checks each again.
  const option = (a: (typeof chart)[number]) => ({ id: a.id, label: `${a.code} · ${a.name}` });
  const open = chart.filter((a) => a.isPostable && a.isActive);
  const expenseHeads = open.filter((a) => a.accountType === "expense").map(option);
  const incomeHeads = open.filter((a) => a.accountType === "income").map(option);
  const moneyAccounts = open
    .filter((a) => a.accountType === "asset" && /cash|bank/i.test(a.name))
    .map(option);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The general ledger for {ctx?.currentSessionName ?? "the current session"}. Fee receipts
            and salary payments post here through rules stored as data, so the books and the
            subledgers can never quietly disagree.
          </p>
        </div>
        {canPost && moneyAccounts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <CashEntryButton kind="expense" heads={expenseHeads} moneyAccounts={moneyAccounts} />
            <CashEntryButton kind="income" heads={incomeHeads} moneyAccounts={moneyAccounts} />
          </div>
        )}
      </div>
      <ModuleCards module="accounts" />

      <ChartView
        chart={chart}
        trialBalance={trialBalance}
        rules={rules}
        unposted={unposted}
        canManage={canManage}
        canPost={canPost}
      />

      <YearEndCard closes={closes} canManage={canManage} suggestedDate={suggestedClose} />
    </div>
  );
}
