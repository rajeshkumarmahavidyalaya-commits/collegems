import Link from "next/link";
import { FilePlus2, History, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { InvoicesTable } from "./invoices-table";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  // The reference's header buttons, each drawn on the permission its screen
  // needs; the screens remain the gate (rule 4).
  const [ctx, canCollect] = await Promise.all([getUserContext(), hasPermission("fees.collect")]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Student Fee Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Every bill raised for {ctx?.currentSessionName ?? "the current session"}. Open one to
            print it or hand it to a family.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCollect && (
            <Button asChild variant="outline">
              <Link href="/fees/daybook">
                <History className="size-4" aria-hidden="true" />
                Payment History
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/fees">
              <IndianRupee className="size-4" aria-hidden="true" />
              Balances
            </Link>
          </Button>
          {canCollect && (
            <Button asChild variant="outline">
              <Link href="/fees/counter">
                <FilePlus2 className="size-4" aria-hidden="true" />
                Add New Fee Invoice
              </Link>
            </Button>
          )}
        </div>
      </div>

      <InvoicesTable />
    </div>
  );
}
