import Link from "next/link";
import { CalendarClock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../students/actions";
import { listTeachers } from "../academics/actions";
import { getOwnStaffId, listLessonSlots, listRooms, listTeachingWeekdays } from "./actions";
import { RoutineGrid } from "./routine-grid";

export const metadata = { title: "Class routine" };

export default async function TimetablePage() {
  const [ctx, sections, slots, teachingWeekdays, rooms, teachers, ownStaffId, canManage] =
    await Promise.all([
      getUserContext(),
      listSections(),
      listLessonSlots(),
      listTeachingWeekdays(),
      listRooms(),
      listTeachers(),
      getOwnStaffId(),
      hasPermission("academics.manage"),
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Class routine</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The weekly grid for {ctx?.currentSessionName ?? "the current session"}. A teacher
            cannot be in two rooms at once and a room cannot hold two classes at once — the
            database refuses it, so the grid you build is one that can actually be taught.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ownStaffId && (
            <Button asChild variant="outline">
              <Link href="/timetable/me">
                <CalendarClock className="size-4" aria-hidden="true" />
                My week
              </Link>
            </Button>
          )}
          {canManage && (
            <Button asChild variant="outline">
              <Link href="/timetable/teachers">
                <UserRound className="size-4" aria-hidden="true" />
                Teaching load
              </Link>
            </Button>
          )}
        </div>
      </div>

      <RoutineGrid
        sections={sections}
        slots={slots}
        teachingWeekdays={teachingWeekdays}
        rooms={rooms}
        teachers={teachers}
        canManage={canManage}
      />
    </div>
  );
}
