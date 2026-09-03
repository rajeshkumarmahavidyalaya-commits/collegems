import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { schoolToday } from "@/lib/validations/homework";
import { getChart, getVoucherLines, listVouchers } from "../actions";
import { VoucherBook } from "./voucher-book";

export const metadata = { title: "Voucher book" };

export default async function VouchersPage() {
  const [canView, canPost] = await Promise.all([
    hasPermission("accounts.view"),
    hasPermission("accounts.post"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Voucher book</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The voucher book is visible to the office and the accountant.
        </p>
      </div>
    );
  }

  const [vouchers, chart] = await Promise.all([listVouchers(100), getChart()]);
  const lines = await getVoucherLines(vouchers.map((v) => v.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/accounts">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Accounts
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Voucher book</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The last 100 entries. Numbers are gapless per session, because an accountant&apos;s first
          question of any voucher is where number 47 went.
        </p>
      </div>

      <VoucherBook
        vouchers={vouchers}
        lines={lines}
        postable={chart.filter((a) => a.isPostable && a.isActive)}
        today={schoolToday()}
        canPost={canPost}
      />
    </div>
  );
}
