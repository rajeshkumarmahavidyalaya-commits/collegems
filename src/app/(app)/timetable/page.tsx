import Link from "next/link";
import { CalendarClock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { listMyChildren } from "@/lib/auth/family";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../students/actions";
import { listTeachers } from "../academics/actions";
import { getOwnStaffId, listLessonSlots, listRooms, listTeachingWeekdays } from "./actions";
import { RoutineGrid } from "./routine-grid";

export const metadata = { title: "Class routine" };

export default async function TimetablePage() {
  const [ctx, allSections, slots, teachingWeekdays, rooms, teachers, ownStaffId, canManage] =
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

  // A family opens this page to see one week: their own child's.
  //
  // It used to hand them the office's screen unchanged — a picker of every
  // class in the school, defaulting to `sections[0]`, which is Grade 1 A. A
  // guardian of a child in Grade 6 A therefore landed on another class's
  // timetable, in full, and had to know their child's class by name to find the
  // right one among twenty-four entries (twenty-four because the picker was not
  // scoped to the year either; that half is fixed in `listSections`).
  //
  // The list is the fix: `RoutineGrid` already defaults to the first entry, so
  // narrowing the list narrows the default with it. `listMyChildren()` is the
  // relationship — a member of staff gets `[]` from it and keeps the whole
  // school, which is what they came for.
  const isFamily = ctx?.roleCode === "parent" || ctx?.roleCode === "student";
  const children = isFamily ? await listMyChildren() : [];
  const familySections = children
    .filter((child) => child.sectionId && child.sectionLabel)
    .map((child) => ({ id: child.sectionId as string, label: child.sectionLabel as string }));
  const sections = isFamily ? familySections : allSections;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Class routine</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {isFamily
              ? `The weekly grid for ${ctx?.currentSessionName ?? "the current session"}. A change
                 made by the school appears here the same day — this is the timetable, not a copy
                 of it.`
              : `The weekly grid for ${ctx?.currentSessionName ?? "the current session"}. A teacher
                 cannot be in two rooms at once and a room cannot hold two classes at once — the
                 database refuses it, so the grid you build is one that can actually be taught.`}
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
        emptySections={
          isFamily
            ? {
                title: "No class to show a routine for",
                description:
                  "This login is not linked to a child with a current enrolment. The school office can link it, or confirm which class the child is in this year.",
              }
            : undefined
        }
      />
    </div>
  );
}
