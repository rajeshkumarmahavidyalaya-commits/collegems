import Link from "next/link";
import { BookOpenCheck, IndianRupee } from "lucide-react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listFeeHeads } from "../actions";
import { FeeCounter } from "./fee-counter";

export const metadata = { title: "Fee counter" };

export default async function FeeCounterPage() {
  const [ctx, canCollect] = await Promise.all([getUserContext(), hasPermission("fees.collect")]);

  // Unlike the read-only screens, this page exists only to write money. Someone
  // without the permission has nothing to do here, so send them to the
  // collection view rather than rendering a desk with every control disabled.
  if (!canCollect) redirect("/fees");

  const feeHeads = await listFeeHeads();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fee counter</h1>
          <p className="text-sm text-muted-foreground">
            Take payments, add dues, apply discounts and fines for{" "}
            {ctx?.currentSessionName ?? "the current session"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/fees/daybook">
              <BookOpenCheck className="size-4" aria-hidden="true" />
              Day book
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/fees">
              <IndianRupee className="size-4" aria-hidden="true" />
              All balances
            </Link>
          </Button>
        </div>
      </div>

      <FeeCounter feeHeads={feeHeads.filter((h) => h.is_active)} />
    </div>
  );
}
