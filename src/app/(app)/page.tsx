import {
  Award,
  BookMarked,
  Building2,
  ClipboardCheck,
  EyeOff,
  GraduationCap,
  IndianRupee,
  TriangleAlert,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { getLocale } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/i18n/format";
import { StatCard } from "@/components/dashboard/stat-card";
import { EnrollmentChart, type EnrollmentDatum } from "@/components/dashboard/enrollment-chart";
import { DonutChart, type DonutDatum } from "@/components/dashboard/donut-chart";
import {
  ExamCard,
  FeesCard,
  LibraryCard,
  StaffRegisterCard,
  StudentRegisterCard,
} from "@/components/dashboard/brief-cards";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  parseDashboardSummary,
  studentRegisterReading,
  withheldSentence,
} from "@/lib/validations/dashboard";

export const metadata = { title: "Dashboard" };

/**
 * The home page: a brief of everything, in one round trip.
 *
 * It used to make seven separate queries and count three hundred enrolment rows
 * in JavaScript to draw twelve bars. It now makes one call to
 * `dashboard_summary()`, which aggregates in Postgres and hands back a single
 * jsonb document. Rule 7's test is boundedness, and one row is bounded however
 * large the school gets.
 *
 * Two consequences worth knowing before editing this file:
 *
 *   - **What each role sees is decided in Postgres, not here.** Every block is
 *     gated on the permission matrix inside the function, and the blocks a role
 *     may not see come back named in `withheld`. So there is no `if (isAdmin)`
 *     in this file, and adding one would be a second answer to a question that
 *     already has one.
 *   - **A card that is absent is not the same as a card that is empty.** A
 *     withheld block is explained at the foot of the page; an empty one — no
 *     exam published, no register taken — says so in its own words.
 */
export default async function DashboardPage() {
  const ctx = await getUserContext();
  const locale = await getLocale();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("dashboard_summary");
  const brief = error ? null : parseDashboardSummary(data);

  const heading = (
    <div>
      <h1 className="text-2xl font-semibold">Welcome back, {ctx?.displayName.split(" ")[0]}</h1>
      <p className="text-sm text-muted-foreground">
        {ctx?.tenantName} · {ctx?.currentSessionName ?? "No active session"}
      </p>
    </div>
  );

  // The designed error state, per the checklist. Never a spinner on a blank
  // page, and never a wall of zeros that reads as a school with nobody in it.
  if (!brief) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <Alert variant="destructive">
          <TriangleAlert className="size-4" aria-hidden="true" />
          <AlertTitle>The dashboard could not be loaded</AlertTitle>
          <AlertDescription>
            {error?.message ??
              "The summary came back in a shape this page did not recognise."}{" "}
            Every module is still reachable from the menu — this page is a summary of them, not the
            way in.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const enrolment = brief.enrolment ?? [];
  const enrollmentData: EnrollmentDatum[] = enrolment.map((row) => ({
    grade: row.grade,
    students: row.students,
  }));

  const genderTotals = enrolment.reduce(
    (acc, row) => ({
      male: acc.male + row.male,
      female: acc.female + row.female,
      other: acc.other + row.other,
      unstated: acc.unstated + row.unstated,
    }),
    { male: 0, female: 0, other: 0, unstated: 0 },
  );

  // Slices that would be zero are dropped, but "unstated" is kept when it is
  // not — a donut whose parts do not add up to the roll is a bug report waiting
  // to be filed.
  const genderData: DonutDatum[] = [
    { name: "Male", value: genderTotals.male },
    { name: "Female", value: genderTotals.female },
    { name: "Other", value: genderTotals.other },
    { name: "Unstated", value: genderTotals.unstated },
  ].filter((d) => d.value > 0);

  const studentRegister = brief.student_attendance;
  const attendanceReading = studentRegister ? studentRegisterReading(studentRegister) : null;
  const attendanceValue =
    attendanceReading === null
      ? "—"
      : attendanceReading.kind === "taken"
        ? `${attendanceReading.percent}%`
        : attendanceReading.kind === "holiday"
          ? "Holiday"
          : "Not taken";

  const withheld = withheldSentence(brief.withheld);

  return (
    <div className="flex flex-col gap-6">
      {heading}

      {/* The headline row: the four numbers somebody wants before they have
          finished sitting down. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students on roll"
          value={brief.school ? String(brief.school.students) : "—"}
          icon={GraduationCap}
          hint={brief.school ? `Across ${brief.school.sections} sections` : "Not shown for your role"}
        />
        <StatCard
          label="Staff on roll"
          value={brief.school?.staff !== null && brief.school?.staff !== undefined ? String(brief.school.staff) : "—"}
          icon={Users}
          hint={
            brief.school?.staff === null || brief.school?.staff === undefined
              ? "Not shown for your role"
              : "Active employees"
          }
        />
        <StatCard
          label="Attendance today"
          value={attendanceValue}
          icon={ClipboardCheck}
          tone={
            attendanceReading?.kind !== "taken"
              ? "default"
              : attendanceReading.percent >= 85
                ? "success"
                : "warning"
          }
          hint={
            studentRegister
              ? `${studentRegister.present} present · ${studentRegister.absent} absent`
              : "Not shown for your role"
          }
        />
        <StatCard
          label="Fees outstanding"
          // Compact, because a headline card is not where somebody reads a
          // figure to the paisa -- the fees card below prints it in full.
          // Through `formatNumber`, never a locale tag written here: rule 15.
          value={
            brief.fees
              ? formatNumber(brief.fees.outstanding, locale, {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                  notation: "compact",
                })
              : "—"
          }
          icon={IndianRupee}
          tone={brief.fees && brief.fees.outstanding > 0 ? "warning" : "success"}
          hint={
            brief.fees
              ? `${brief.fees.students_owing} still to pay`
              : "Not shown for your role"
          }
        />
      </div>

      {/* Both registers, side by side. They were never on the same screen
          before, and "who is in today" is one question about a school, not two
          about two kinds of person. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {studentRegister && (
          <StudentRegisterCard register={studentRegister} icon={ClipboardCheck} />
        )}
        {brief.staff_attendance && (
          <StaffRegisterCard register={brief.staff_attendance} icon={Users} />
        )}
      </div>

      {/* Money and results. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {brief.fees && <FeesCard fees={brief.fees} icon={IndianRupee} />}
        {!brief.withheld.includes("exam") && <ExamCard exam={brief.exam} icon={Award} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EnrollmentChart data={enrollmentData} />
        </div>
        <DonutChart title="Students by gender" description="Active enrolments" data={genderData} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {brief.library && <LibraryCard library={brief.library} icon={BookMarked} />}
        <StatCard
          label="Sections running"
          value={brief.school ? String(brief.school.sections) : "—"}
          icon={Building2}
          hint={ctx?.currentSessionName ?? "No active session"}
        />
        <StatCard
          label="Books overdue"
          value={brief.library ? String(brief.library.overdue) : "—"}
          icon={TriangleAlert}
          tone={brief.library && brief.library.overdue > 0 ? "warning" : "success"}
          hint={brief.library ? `${brief.library.issued} out on loan` : "Not shown for your role"}
        />
      </div>

      {withheld && (
        <Alert>
          <EyeOff className="size-4" aria-hidden="true" />
          <AlertTitle>Some cards are hidden</AlertTitle>
          <AlertDescription>{withheld}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
