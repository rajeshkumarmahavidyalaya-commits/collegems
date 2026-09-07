import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { listAllSections } from "../actions";
import { AttendanceReport } from "./attendance-report";
import { CoverageCard } from "./coverage-card";

export const metadata = { title: "Attendance report" };

export default async function AttendanceReportPage() {
  const [ctx, sections] = await Promise.all([getUserContext(), listAllSections()]);

  // The last month, which is the window somebody notices a gap in. Longer than
  // that and the answer is the catalog report, which takes a range.
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const coverageFrom = iso(monthAgo);
  const coverageTo = iso(today);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Attendance report</h1>
          <p className="text-sm text-muted-foreground">
            Per-student totals for a class over a date range, for{" "}
            {ctx?.currentSessionName ?? "the current session"}. Late counts as attended; excused
            days are left out of the percentage rather than counted against the student.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/attendance">
            <ClipboardCheck className="size-4" aria-hidden="true" />
            Take register
          </Link>
        </Button>
      </div>

      <AttendanceReport sections={sections} />

      <CoverageCard from={coverageFrom} to={coverageTo} />
    </div>
  );
}
