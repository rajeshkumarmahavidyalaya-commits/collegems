import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../students/actions";
import {
  listAssignments,
  listClassRooms,
  listHolidays,
  listSubjects,
  listTeachers,
  listTimeSlots,
  listWeekdays,
} from "./actions";
import { AcademicsSettings } from "./academics-settings";

export const metadata = { title: "Academics" };

export default async function AcademicsPage() {
  const [
    ctx,
    subjects,
    rooms,
    slots,
    weekdays,
    holidays,
    assignments,
    sections,
    teachers,
    canManage,
    canSeeSyllabus,
  ] = await Promise.all([
    getUserContext(),
    listSubjects(),
    listClassRooms(),
    listTimeSlots(),
    listWeekdays(),
    listHolidays(),
    listAssignments(),
    listSections(),
    listTeachers(),
    hasPermission("academics.manage"),
    // The syllabus screen reads on `academics.view`, so the link is gated on
    // the permission the destination itself checks — a button to a screen that
    // will refuse you is the same defect one click along.
    hasPermission("academics.view"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Academics</h1>
          <p className="text-sm text-muted-foreground">
            What is taught, by whom, where and when — for{" "}
            {ctx?.currentSessionName ?? "the current session"}. The timetable, marks entry and
            homework all read from here.
          </p>
        </div>
        {canSeeSyllabus && (
          <Button asChild variant="outline">
            <Link href="/academics/syllabus">
              <BookOpen className="size-4" aria-hidden="true" />
              Syllabus
            </Link>
          </Button>
        )}
      </div>

      <AcademicsSettings
        subjects={subjects}
        rooms={rooms}
        slots={slots}
        weekdays={weekdays}
        holidays={holidays}
        assignments={assignments}
        sections={sections}
        teachers={teachers}
        canManage={canManage}
      />
    </div>
  );
}
