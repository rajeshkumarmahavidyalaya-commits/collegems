import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { listAllSections } from "../actions";
import { AttendanceReport } from "./attendance-report";

export const metadata = { title: "Attendance report" };

export default async function AttendanceReportPage() {
  const [ctx, sections] = await Promise.all([getUserContext(), listAllSections()]);

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
    </div>
  );
}
