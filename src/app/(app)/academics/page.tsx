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
    hasPermission("settings.manage"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Academics</h1>
        <p className="text-sm text-muted-foreground">
          What is taught, by whom, where and when — for{" "}
          {ctx?.currentSessionName ?? "the current session"}. The timetable, marks entry and
          homework all read from here.
        </p>
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
