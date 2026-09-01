import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { DayBookView } from "./day-book";

export const metadata = { title: "Day book" };

export default async function DayBookPage() {
  const ctx = await getUserContext();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Day book</h1>
          <p className="text-sm text-muted-foreground">
            Every payment and refund that crossed the counter, for{" "}
            {ctx?.currentSessionName ?? "the current session"} — what the drawer is reconciled
            against at close of day.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/fees/counter">
            <IndianRupee className="size-4" aria-hidden="true" />
            Fee counter
          </Link>
        </Button>
      </div>

      <DayBookView />
    </div>
  );
}
