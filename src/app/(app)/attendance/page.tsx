import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listMarkableSections } from "./actions";
import { AttendanceMarker } from "./attendance-marker";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  const [ctx, sections, canMark] = await Promise.all([
    getUserContext(),
    listMarkableSections(),
    hasPermission("attendance.mark"),
  ]);

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

      <AttendanceMarker sections={sections} canMark={canMark} />
    </div>
  );
}
