import Link from "next/link";
import { ArrowLeft, CalendarOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { listLeave, listStudentsForLeave } from "./actions";
import { LeaveList } from "./leave-list";

export const metadata = { title: "Student leave" };

/**
 * Leave asked for and decided.
 *
 * Everything on this page is scoped by RLS rather than by a role branch: an
 * administrator sees the school, a class teacher sees their own section, a
 * family sees their own children. The permission checks below only decide which
 * *controls* to render — the policies decide what happens if somebody sends the
 * request anyway.
 */
export default async function StudentLeavePage() {
  const [leave, students, canApply, canDecide] = await Promise.all([
    listLeave(),
    listStudentsForLeave(),
    hasPermission("leave.apply"),
    hasPermission("leave.decide"),
  ]);

  const waiting = leave.filter((l) => l.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/attendance"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Attendance
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Student leave</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A family tells the school a child will be away; a class teacher or the office decides.
        </p>
      </div>

      <Alert>
        <CalendarOff className="size-4" aria-hidden="true" />
        <AlertTitle>
          {waiting === 0 ? "Nothing waiting for a decision" : `${waiting} waiting for a decision`}
        </AlertTitle>
        <AlertDescription>
          Approving leave does not mark the register — the register is what a teacher observed, and
          a child on approved leave who turns up is present. What it does change is that the
          evening absence notice stops texting the family about something they told the school.
        </AlertDescription>
      </Alert>

      {leave.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing here yet</CardTitle>
            <CardDescription>
              {canApply
                ? "Nobody has asked for leave. Requests appear here as soon as they are made."
                : "No leave has been requested for anybody you can see."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <LeaveList
        leave={leave}
        students={students}
        canApply={canApply}
        canDecide={canDecide}
      />
    </div>
  );
}
