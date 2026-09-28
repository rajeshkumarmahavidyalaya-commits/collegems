import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listMarkableSections, sectionsMarkedToday } from "./actions";
import { AttendanceMarker } from "./attendance-marker";
import { ModuleCards } from "@/components/module-cards";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ section }, ctx, sections, canMark, marked] = await Promise.all([
    searchParams,
    getUserContext(),
    listMarkableSections(),
    hasPermission("attendance.mark"),
    sectionsMarkedToday(),
  ]);

  // Open on the class asked for, else the first one nobody has marked today,
  // else the first -- never an arbitrary one when a choice is obvious.
  const markedSet = new Set(marked);
  const initialSectionId =
    sections.find((s) => s.id === section)?.id ??
    sections.find((s) => !markedSet.has(s.id))?.id ??
    sections[0]?.id ??
    "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Attendance</h1>
          <p className="text-sm text-muted-foreground">
            Take the register for {ctx?.currentSessionName ?? "the current session"}. Marks save
            themselves as you go.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/attendance/report">
            <BarChart3 className="size-4" aria-hidden="true" />
            Attendance report
          </Link>
        </Button>
      </div>
      <ModuleCards module="attendance" />

      <AttendanceMarker
        sections={sections}
        canMark={canMark}
        initialSectionId={initialSectionId}
        markedToday={marked}
      />
    </div>
  );
}
