import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { InvoicesTable } from "./invoices-table";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const ctx = await getUserContext();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            Every bill raised for {ctx?.currentSessionName ?? "the current session"}. Open one to
            print it or hand it to a family.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/fees">
            <IndianRupee className="size-4" aria-hidden="true" />
            Balances
          </Link>
        </Button>
      </div>

      <InvoicesTable />
    </div>
  );
}
