import {
  Award,
  BookMarked,
  BookOpen,
  Building2,
  CalendarClock,
  CalendarX2,
  CircleAlert,
  ClipboardCheck,
  EyeOff,
  FileWarning,
  GraduationCap,
  HandCoins,
  IndianRupee,
  Layers,
  MessageSquareText,
  Receipt,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { getReferenceFigures } from "@/components/dashboard/reference-figures";
import { ReferenceLists } from "@/components/dashboard/reference-lists";
import type { StatTone } from "@/components/dashboard/stat-card";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import Link from "next/link";
import { getLocale, getT } from "@/lib/i18n/server";
import { hasPermission } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { SchoolCalendar } from "@/components/dashboard/school-calendar";
import { formatNumber } from "@/lib/i18n/format";
import { StatCard } from "@/components/dashboard/stat-card";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { ModuleGrid } from "@/components/dashboard/module-grid";
import { ListTodo } from "lucide-react";
import { EnrollmentChartLazy, DonutChartLazy } from "@/components/dashboard/charts";
import type { EnrollmentDatum } from "@/components/dashboard/enrollment-chart";
import type { DonutDatum } from "@/components/dashboard/donut-chart";
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
  withheldSentence,
} from "@/lib/validations/dashboard";

export const metadata = { title: "Dashboard" };

const TONES: StatTone[] = ["default", "success", "warning", "danger"];

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
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  // The buttons are drawn on the permissions their screens check; the screens
  // remain the gate (rule 4).
  const [{ month }, ctx, locale, t, supabase, canConfigure, canInvite] = await Promise.all([
    searchParams,
    getUserContext(),
    getLocale(),
    getT(),
    createClient(),
    hasPermission("academics.manage"),
    hasPermission("users.manage"),
  ]);

  const [{ data, error }, figures] = await Promise.all([
    supabase.rpc("dashboard_summary"),
    getReferenceFigures(ctx?.currentSessionId ?? null),
  ]);
  const brief = error ? null : parseDashboardSummary(data);

  // The reference's green title bar and its three buttons. "Add Class" and
  // "Manage Sections" both land on the classes tab, where a class is added and
  // its sections are kept; "Assign Admins" is the logins screen. The school and
  // the session are in the band above every page (SchoolContext).
  const heading = (
    <PageToolbar title={t("dashboard.toolbarTitle")}>
      {canConfigure && (
        <Button asChild>
          <Link href="/academics?tab=classes">{t("dashboard.ref.addClass")}</Link>
        </Button>
      )}
      {canConfigure && (
        <Button asChild>
          <Link href="/academics?tab=classes">{t("dashboard.ref.manageSections")}</Link>
        </Button>
      )}
      {canInvite && (
        <Button asChild>
          <Link href="/settings/team">{t("dashboard.ref.assignAdmins")}</Link>
        </Button>
      )}
    </PageToolbar>
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

  const money = (v: number) =>
    formatNumber(v, locale, { style: "currency", currency: "INR", maximumFractionDigits: 0, notation: "compact" });
  const session = ctx?.currentSessionName ?? t("dashboard.ref.thisYear");
  const all: { key: string; label: string; value: string | null; icon: LucideIcon; hint?: string }[] = [
    { key: "inquiries", label: t("dashboard.ref.activeInquiries"), value: figures.activeInquiries === null ? null : String(figures.activeInquiries), icon: MessageSquareText },
    { key: "students", label: t("dashboard.ref.activeStudents"), value: brief.school ? String(brief.school.students) : null, icon: GraduationCap, hint: session },
    { key: "classes", label: t("dashboard.ref.totalClasses"), value: figures.classes === null ? null : String(figures.classes), icon: Layers },
    { key: "staff", label: t("dashboard.ref.totalStaff"), value: brief.school?.staff == null ? null : String(brief.school.staff), icon: Users },
    { key: "income", label: t("dashboard.ref.totalIncome"), value: figures.income === null ? null : money(figures.income), icon: HandCoins, hint: session },
    { key: "collected", label: t("dashboard.ref.feesCollected"), value: brief.fees ? money(brief.fees.collected) : null, icon: IndianRupee, hint: session },
    { key: "dues", label: t("dashboard.ref.pendingDues"), value: brief.fees ? money(brief.fees.outstanding) : null, icon: CircleAlert, hint: session },
    // The reference counts unpaid invoices; this backend keeps balances per
    // child, not per invoice, so it counts the children who owe instead.
    { key: "owing", label: t("dashboard.ref.studentsWithDues"), value: brief.fees ? String(brief.fees.students_owing) : null, icon: FileWarning, hint: session },
    { key: "expenses", label: t("dashboard.ref.totalExpenses"), value: figures.expenses === null ? null : money(figures.expenses), icon: Receipt, hint: session },
    { key: "books", label: t("dashboard.ref.totalBooks"), value: figures.books === null ? null : String(figures.books), icon: BookOpen, hint: t("dashboard.ref.titles") },
    { key: "studentLeave", label: t("dashboard.ref.pendingStudentLeaves"), value: figures.pendingStudentLeave === null ? null : String(figures.pendingStudentLeave), icon: CalendarClock, hint: t("dashboard.ref.awaitingDecision") },
    { key: "staffLeave", label: t("dashboard.ref.pendingStaffLeaves"), value: figures.pendingStaffLeave === null ? null : String(figures.pendingStaffLeave), icon: CalendarX2, hint: t("dashboard.ref.awaitingDecision") },
  ];
  const cards = all.filter((c): c is typeof c & { value: string } => c.value !== null);
  const hiddenCards = [
    ...all.filter((c) => c.value === null).map((c) => c.label),
    ...(figures.admissions === null ? [t("dashboard.ref.lastAdmissions", { session })] : []),
  ];
  const hiddenSentence = hiddenCards.length
    ? t("dashboard.ref.withheld", { list: new Intl.ListFormat(locale, { type: "conjunction" }).format(hiddenCards) })
    : null;

  const withheld = withheldSentence(brief.withheld);

  return (
    <div className="flex flex-col gap-6">
      {heading}

      {/* The reference's twelve figures, in its order and its four colours.
          A figure this person may not see is left out and named at the foot
          of the page; it is never drawn as a zero (rule 11). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c, i) => (
          <StatCard key={c.key} label={c.label} value={c.value} icon={c.icon} hint={c.hint} tone={TONES[i % 4]} />
        ))}
      </div>

      {/* The reference's month, under the figures: holidays, exams, fee due
          dates and notices from school_calendar(), as each module's policies
          allow this seat to see them. */}
      <SchoolCalendar today={brief.today} month={month} locale={locale} />

      <ReferenceLists
        inquiries={figures.inquiries}
        admissions={figures.admissions}
        sessionName={ctx?.currentSessionName ?? null}
        locale={locale}
        t={t}
      />

      {/* Only while something is left to set up, and only the steps this
          person may act on (0284). */}
      <SetupChecklist />

      {/* Staff and the principal get every module on one screen (0290); a
          family keeps the few links that are theirs. Which audience sees which
          is a tier, and a tier decides only what is shown (0208): the tiles
          themselves are gated on the matrix inside module_overview(). */}
      {ctx?.roleTier === "student" ? (
        /* A student's own subjects is theirs by record, not by permission --
           `subject_choice_save` takes the student from the login -- so this one
           link follows what the login stands for (roles.subject), for display. */
        <QuickActions
          extra={
            ctx?.roleSubject === "student"
              ? [{ href: "/my-subjects", label: "My subjects", hint: "See and choose electives", icon: ListTodo }]
              : []
          }
        />
      ) : (
        <ModuleGrid
          fromBrief={{
            fees: { count: brief.fees?.receipts_today ?? null },
            staff_attendance: {
              count: brief.staff_attendance?.marked ?? null,
              total: brief.staff_attendance?.roll ?? null,
            },
          }}
        />
      )}


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
        {brief.fees && <FeesCard fees={brief.fees} icon={IndianRupee} locale={locale} />}
        {!brief.withheld.includes("exam") && <ExamCard exam={brief.exam} icon={Award} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EnrollmentChartLazy data={enrollmentData} />
        </div>
        <DonutChartLazy title="Students by gender" description="Active enrolments" data={genderData} />
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

      {(withheld || hiddenSentence) && (
        <Alert>
          <EyeOff className="size-4" aria-hidden="true" />
          <AlertTitle>Some cards are hidden</AlertTitle>
          <AlertDescription>
            {[withheld, hiddenSentence].filter(Boolean).join(" ")}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
