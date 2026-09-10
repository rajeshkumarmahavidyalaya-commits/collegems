import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listAllSections } from "../actions";
import { AttendanceReport } from "./attendance-report";
import { CoverageCard } from "./coverage-card";

export const metadata = { title: "Attendance report" };

export default async function AttendanceReportPage() {
  const [ctx, sections, canSeeCoverage, canRead] = await Promise.all([
    getUserContext(),
    listAllSections(),
    // The same question is `attendance.gaps` in the report catalogue, and
    // migration 0201 moved that to `attendance.mark` -- the permission held by
    // somebody who can go and take the missing register. A card showing the
    // same facts the report refuses would be the menu and the boundary
    // disagreeing again, one screen down.
    hasPermission("attendance.mark"),
    // ...and the per-student half is the same question as `attendance.summary`
    // in that catalogue, which is gated on `attendance.view`. It had no gate at
    // all, and `attendance_records` carries a `staff roles view attendance`
    // policy covering admin AND accountant -- so an accountant, holding no
    // attendance permission and unable to run that report, read every child's
    // register from this screen instead. Two answers to one question.
    hasPermission("attendance.view"),
  ]);

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
        {canSeeCoverage && (
          <Button asChild variant="outline">
            <Link href="/attendance">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Take register
            </Link>
          </Button>
        )}
      </div>

      {canRead ? (
        <AttendanceReport sections={sections} />
      ) : (
        // Absent-and-withheld reads as a bug, so it is a sentence (rule 11).
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
        >
          Your role does not see attendance figures. If that is wrong, an administrator can grant{" "}
          <span className="font-mono text-xs">attendance.view</span> on the permissions screen.
        </div>
      )}

      {canSeeCoverage ? <CoverageCard from={coverageFrom} to={coverageTo} /> : null}
    </div>
  );
}
