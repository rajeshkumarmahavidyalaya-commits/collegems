import Link from "next/link";
import { BookOpenCheck, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { attendanceFilters, type ClassFilter } from "../by-actions";
import { SubjectRegister } from "./subject-register";

export const metadata = { title: "Subject attendance" };

/**
 * Attendance by subject needs a subject register to read (0329). The class
 * teacher takes the daily register on /attendance; here the teacher of a
 * subject takes theirs. The list is narrowed to what this person teaches --
 * a convenience, never the gate: the functions answer only an administrator,
 * the class teacher or that subject's teacher, and refuse anybody else.
 */
export default async function SubjectAttendancePage() {
  const [ctx, canMark, classes, supabase] = await Promise.all([
    getUserContext(),
    hasPermission("attendance.mark"),
    attendanceFilters(),
    createClient(),
  ]);
  const { data: today } = await supabase.rpc("mobile_today");
  const todayIso = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);

  const isAdmin = ctx?.roleCode === "admin";
  const staffId = ctx?.staffId ?? null;
  const mine: ClassFilter[] = isAdmin
    ? classes
    : classes
        .map((c) => ({
          ...c,
          sections: c.sections
            .map((s) => ({
              ...s,
              subjects:
                staffId && s.classTeacherStaffId === staffId
                  ? s.subjects
                  : s.subjects.filter((sub) => staffId && sub.teacherStaffId === staffId),
            }))
            .filter((s) => s.subjects.length > 0),
        }))
        .filter((c) => c.sections.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Subject Attendance" icon={BookOpenCheck}>
        <Button asChild variant="outline">
          <Link href="/attendance/report">
            <ClipboardList className="size-4" aria-hidden="true" />
            Attendance report
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        The register for one subject&apos;s class, kept apart from the daily register so a lecture is
        never counted as a day. Read it back under Attendance report › Attendance By Subject.
      </p>
      {canMark || isAdmin ? (
        <SubjectRegister classes={mine} today={todayIso} />
      ) : (
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          Taking a register needs <code>attendance.mark</code>, which your role does not hold.
        </p>
      )}
    </div>
  );
}
