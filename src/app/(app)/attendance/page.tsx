import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listMarkableSections, sectionsMarkedToday } from "./actions";
import { AttendanceMarker } from "./attendance-marker";
import { ModuleCards } from "@/components/module-cards";
import { getT } from "@/lib/i18n/server";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ section }, ctx, sections, canMark, canView, marked, t] = await Promise.all([
    searchParams,
    getUserContext(),
    listMarkableSections(),
    hasPermission("attendance.mark"),
    hasPermission("attendance.view"),
    sectionsMarkedToday(),
    getT(),
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
      </div>
      <ModuleCards module="attendance" />
      {/* The reference's Take / View pair. The report is drawn only for the
          permission it checks (0201), so nobody is shown a tab that refuses. */}
      {canView && (
        <nav className="flex gap-2 border-b pb-3" aria-label={t("attendance.views")}>
          <Button asChild>
            <Link href="/attendance" aria-current="page">
              {t("attendance.take")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/attendance/report">{t("attendance.view")}</Link>
          </Button>
        </nav>
      )}

      <AttendanceMarker
        sections={sections}
        canMark={canMark}
        initialSectionId={initialSectionId}
        markedToday={marked}
      />
    </div>
  );
}
