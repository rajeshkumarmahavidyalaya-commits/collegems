import Link from "next/link";
import { BadgeCheck, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { listClaims, type ClaimStatus } from "./actions";
import { VerifyTable } from "./verify-table";

export const metadata = { title: "Verify Payments" };

const TABS: { status: ClaimStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Turned down" },
];

/**
 * The reference's Verify Payments (0353): a family's bank or UPI payment,
 * checked against the bank statement and approved into an ordinary receipt.
 * The policies decide who reads the list; the page is gated on fees.collect so
 * a seat that holds neither sees a sentence rather than an empty table.
 */
export default async function VerifyPaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status: ClaimStatus = raw === "approved" || raw === "rejected" ? raw : "pending";
  const [canCollect, canManage] = await Promise.all([hasPermission("fees.collect"), hasPermission("fees.manage")]);

  if (!canCollect) {
    return (
      <div className="flex flex-col gap-4">
        <PageToolbar title="Verify Payments" icon={BadgeCheck} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Checking a family&apos;s payment is for the people who take fees. Your role does not.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { rows, total, counts } = await listClaims(status);

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Verify Payments" icon={BadgeCheck}>
        {canManage && (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/school#setting-fees.payment_methods">
              <Settings className="size-4" aria-hidden="true" />
              Bank and UPI details
            </Link>
          </Button>
        )}
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Payments families say they made by bank transfer or UPI. Check each against the bank statement. Approving
        writes a receipt and tells the family; turning one down sends them your reason.
      </p>
      <nav aria-label="Payment status" className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.status}
            href={`/fees/verify?status=${tab.status}`}
            aria-current={tab.status === status ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              tab.status === status ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {tab.label} ({counts[tab.status]})
          </Link>
        ))}
      </nav>
      <VerifyTable rows={rows} status={status} />
      {total > rows.length && (
        <p className="text-sm text-muted-foreground">
          Showing the first {rows.length} of {total}.
        </p>
      )}
    </div>
  );
}
