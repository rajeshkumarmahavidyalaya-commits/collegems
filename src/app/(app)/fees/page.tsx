import Link from "next/link";
import {
  AlertTriangle,
  BookOpenCheck,
  IndianRupee,
  Settings2,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/validations/fees";
import { listSections } from "../students/actions";
import { getCollectionSummary } from "./actions";
import { FeesTable } from "./fees-table";

export const metadata = { title: "Fees" };

export default async function FeesPage() {
  const [ctx, sections, summary, canCollect, canManage] = await Promise.all([
    getUserContext(),
    listSections(),
    getCollectionSummary(),
    hasPermission("fees.collect"),
    hasPermission("settings.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fees</h1>
          <p className="text-sm text-muted-foreground">
            Collection for {ctx?.currentSessionName ?? "the current session"}. Every payment,
            discount and fine is a permanent ledger entry — corrections are reversals, never edits.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCollect && (
            <Button asChild>
              <Link href="/fees/counter">
                <IndianRupee className="size-4" aria-hidden="true" />
                Fee counter
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/fees/daybook">
              <BookOpenCheck className="size-4" aria-hidden="true" />
              Day book
            </Link>
          </Button>
          {canManage && (
            <Button asChild variant="outline">
              <Link href="/fees/setup">
                <Settings2 className="size-4" aria-hidden="true" />
                Fee setup
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected"
          value={formatMoney(summary.collected)}
          icon={IndianRupee}
          tone="success"
          hint={`of ${formatMoney(summary.charged - summary.relieved)} billable`}
        />
        <StatCard
          label="Outstanding"
          value={formatMoney(summary.outstanding)}
          icon={AlertTriangle}
          tone={summary.outstanding > 0 ? "warning" : "success"}
          hint={`${summary.defaulters} ${summary.defaulters === 1 ? "family owes" : "families owe"}`}
        />
        <StatCard
          label="Collection rate"
          value={summary.collectionRate === null ? "Nothing billed" : `${summary.collectionRate}%`}
          icon={TrendingUp}
          tone={
            summary.collectionRate === null
              ? "default"
              : summary.collectionRate >= 80
                ? "success"
                : "warning"
          }
          hint={`${formatMoney(summary.relieved)} in discounts and write-offs`}
        />
        <StatCard
          label="Held in credit"
          value={formatMoney(summary.inCredit)}
          icon={Users}
          hint={`Across ${summary.students} enrolled students`}
        />
      </div>

      <FeesTable sections={sections} canCollect={canCollect} />
    </div>
  );
}
