import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import {
  countUnposted,
  getChart,
  getTrialBalance,
  listPostingRules,
} from "./actions";
import { ChartView } from "./chart-view";

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

  const [chart, trialBalance, rules, unposted] = await Promise.all([
    getChart(),
    getTrialBalance(),
    listPostingRules(),
    countUnposted(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The general ledger for {ctx?.currentSessionName ?? "the current session"}. Fee receipts
          and salary payments post here through rules stored as data, so the books and the
          subledgers can never quietly disagree.
        </p>
      </div>

      <ChartView
        chart={chart}
        trialBalance={trialBalance}
        rules={rules}
        unposted={unposted}
        canManage={canManage}
        canPost={canPost}
      />
    </div>
  );
}
