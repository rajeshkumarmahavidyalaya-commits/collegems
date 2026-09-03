import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { schoolToday } from "@/lib/validations/homework";
import { getAttendanceSheet } from "./actions";
import { AttendanceRegister, MyAttendance, RegisterDatePicker } from "./attendance-register";

export const metadata = { title: "Staff attendance" };

export default async function StaffAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const date = params.date ?? schoolToday();

  const [ctx, canView, canMark] = await Promise.all([
    getUserContext(),
    hasPermission("hr.view"),
    hasPermission("hr.manage"),
  ]);

  // The register itself is behind RLS; this decides which *screen* a person
  // gets. Somebody with no HR permission sees their own row and nothing else,
  // which is what the row-ownership policy on `staff_attendance` allows anyway.
  const rows = await getAttendanceSheet(date);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">My attendance</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What the office has recorded for you. If something looks wrong, the person who marks the
            register can correct it — nobody can change their own.
          </p>
        </div>
        <MyAttendance rows={rows} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Staff attendance</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The register payroll reads. A working day nobody marked counts as present — a school
            that has not started marking must not have its first payroll dock everybody.
          </p>
        </div>
        <RegisterDatePicker date={date} />
      </div>

      <AttendanceRegister date={date} rows={rows} canMark={canMark} />

      {!canMark && ctx && (
        <p className="text-sm text-muted-foreground">
          You can read this register but not change it: the person who decides who was absent must
          not be the person who decides what that costs them.
        </p>
      )}
    </div>
  );
}
