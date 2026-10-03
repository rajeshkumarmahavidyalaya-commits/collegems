import { cache } from "react";
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
  ListTodo,
  MessageSquareText,
  Receipt,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatCard, type StatTone } from "@/components/dashboard/stat-card";
import { SchoolCalendar } from "@/components/dashboard/school-calendar";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { ModuleGrid } from "@/components/dashboard/module-grid";
import { EnrollmentChartLazy, DonutChartLazy } from "@/components/dashboard/charts";
import type { EnrollmentDatum } from "@/components/dashboard/enrollment-chart";
import type { DonutDatum } from "@/components/dashboard/donut-chart";
import { ExamCard, FeesCard, LibraryCard, StaffRegisterCard, StudentRegisterCard } from "@/components/dashboard/brief-cards";
import { getReferenceFigures } from "@/components/dashboard/reference-figures";
import { ReferenceLists } from "@/components/dashboard/reference-lists";
import { parseDashboardSummary, withheldSentence } from "@/lib/validations/dashboard";

/**
 * The dashboard, section by section, so each one streams on its own (lazy
 * loading). The page draws its title bar at once and every section below
 * arrives when its own read answers, behind a placeholder of the same height;
 * a slow figure no longer holds up the calendar, and vice versa.
 *
 * The reads are memoised per request with React's `cache`, so the sections
 * share one `dashboard_summary()` call and one set of reference figures --
 * splitting the page did not multiply its round trips.
 */

const getBrief = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_summary");
  return { brief: error ? null : parseDashboardSummary(data), error: error?.message ?? null };
});

const getFigures = cache((sessionId: string | null) => getReferenceFigures(sessionId));

const TONES: StatTone[] = ["default", "success", "warning", "danger"];

type Ctx = { sessionId: string | null; sessionName: string | null; locale: Locale };

/** The reference's twelve figures, in its order and its four colours. */
export async function DashboardFigures({ sessionId, sessionName, locale }: Ctx) {
  const [{ brief, error }, figures, t] = await Promise.all([getBrief(), getFigures(sessionId), getT()]);

  // The designed error state, per the checklist. Never a spinner on a blank
  // page, and never a wall of zeros that reads as a school with nobody in it.
  if (!brief) {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <AlertTitle>The dashboard could not be loaded</AlertTitle>
        <AlertDescription>
          {error ?? "The summary came back in a shape this page did not recognise."} Every module is
          still reachable from the menu — this page is a summary of them, not the way in.
        </AlertDescription>
      </Alert>
    );
  }

  const cards = referenceCards(brief, figures, sessionName, locale, t).filter(
    (c): c is ReferenceCard & { value: string } => c.value !== null,
  );
  // A figure this person may not see is left out and named at the foot of the
  // page; it is never drawn as a zero (rule 11).
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c, i) => (
        <StatCard key={c.key} label={c.label} value={c.value} icon={c.icon} hint={c.hint} tone={TONES[i % 4]} />
      ))}
    </div>
  );
}

/** The reference's month, under the figures. */
export async function DashboardCalendar({ month, locale }: { month?: string; locale: Locale }) {
  const { brief } = await getBrief();
  if (!brief) return null;
  return <SchoolCalendar today={brief.today} month={month} locale={locale} />;
}

/** The last ten active inquiries and the last fifteen admissions. */
export async function DashboardLists({ sessionId, sessionName, locale }: Ctx) {
  const [figures, t] = await Promise.all([getFigures(sessionId), getT()]);
  return (
    <ReferenceLists
      inquiries={figures.inquiries}
      admissions={figures.admissions}
      sessionName={sessionName}
      locale={locale}
      t={t}
    />
  );
}

/**
 * The setup checklist and the module grid. Staff and the principal get every
 * module on one screen (0290); a family keeps the few links that are theirs.
 * Which audience sees which is a tier, and a tier decides only what is shown
 * (0208): the tiles themselves are gated on the matrix inside module_overview().
 */
export async function DashboardModules({
  roleTier,
  roleSubject,
}: {
  roleTier: string | null;
  roleSubject: string | null;
}) {
  const { brief } = await getBrief();
  return (
    <>
      <SetupChecklist />
      {roleTier === "student" ? (
        /* A student's own subjects is theirs by record, not by permission --
           `subject_choice_save` takes the student from the login -- so this one
           link follows what the login stands for (roles.subject), for display. */
        <QuickActions
          extra={
            roleSubject === "student"
              ? [{ href: "/my-subjects", label: "My subjects", hint: "See and choose electives", icon: ListTodo }]
              : []
          }
        />
      ) : (
        <ModuleGrid
          fromBrief={{
            fees: { count: brief?.fees?.receipts_today ?? null },
            staff_attendance: {
              count: brief?.staff_attendance?.marked ?? null,
              total: brief?.staff_attendance?.roll ?? null,
            },
          }}
        />
      )}
    </>
  );
}

/** Registers, money, results, charts, the library row, and what was hidden. */
export async function DashboardDetail({ sessionId, sessionName, locale }: Ctx) {
  const [{ brief }, figures, t] = await Promise.all([getBrief(), getFigures(sessionId), getT()]);
  if (!brief) return null;

  const enrolment = brief.enrolment ?? [];
  const enrollmentData: EnrollmentDatum[] = enrolment.map((row) => ({ grade: row.grade, students: row.students }));
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

  const all = referenceCards(brief, figures, sessionName, locale, t);
  const session = sessionName ?? t("dashboard.ref.thisYear");
  const hiddenCards = [
    ...all.filter((c) => c.value === null).map((c) => c.label),
    ...(figures.admissions === null ? [t("dashboard.ref.lastAdmissions", { session })] : []),
  ];
  const hiddenSentence = hiddenCards.length
    ? t("dashboard.ref.withheld", { list: new Intl.ListFormat(locale, { type: "conjunction" }).format(hiddenCards) })
    : null;
  const withheld = withheldSentence(brief.withheld);
  const studentRegister = brief.student_attendance;

  return (
    <>
      {/* Both registers, side by side: "who is in today" is one question about
          a school, not two about two kinds of person. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {studentRegister && <StudentRegisterCard register={studentRegister} icon={ClipboardCheck} />}
        {brief.staff_attendance && <StaffRegisterCard register={brief.staff_attendance} icon={Users} />}
      </div>

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
          hint={sessionName ?? "No active session"}
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
          <AlertDescription>{[withheld, hiddenSentence].filter(Boolean).join(" ")}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

type ReferenceCard = { key: string; label: string; value: string | null; icon: LucideIcon; hint?: string };

/** The twelve, built once for the cards and once for the "hidden" sentence. */
function referenceCards(
  brief: NonNullable<Awaited<ReturnType<typeof getBrief>>["brief"]>,
  figures: Awaited<ReturnType<typeof getReferenceFigures>>,
  sessionName: string | null,
  locale: Locale,
  t: Awaited<ReturnType<typeof getT>>,
): ReferenceCard[] {
  const money = (v: number) =>
    formatNumber(v, locale, { style: "currency", currency: "INR", maximumFractionDigits: 0, notation: "compact" });
  const session = sessionName ?? t("dashboard.ref.thisYear");
  const n = (v: number | null) => (v === null ? null : String(v));
  return [
    { key: "inquiries", label: t("dashboard.ref.activeInquiries"), value: n(figures.activeInquiries), icon: MessageSquareText },
    { key: "students", label: t("dashboard.ref.activeStudents"), value: brief.school ? String(brief.school.students) : null, icon: GraduationCap, hint: session },
    { key: "classes", label: t("dashboard.ref.totalClasses"), value: n(figures.classes), icon: Layers },
    { key: "staff", label: t("dashboard.ref.totalStaff"), value: brief.school?.staff == null ? null : String(brief.school.staff), icon: Users },
    { key: "income", label: t("dashboard.ref.totalIncome"), value: figures.income === null ? null : money(figures.income), icon: HandCoins, hint: session },
    { key: "collected", label: t("dashboard.ref.feesCollected"), value: brief.fees ? money(brief.fees.collected) : null, icon: IndianRupee, hint: session },
    { key: "dues", label: t("dashboard.ref.pendingDues"), value: brief.fees ? money(brief.fees.outstanding) : null, icon: CircleAlert, hint: session },
    // The reference counts unpaid invoices; this backend keeps balances per
    // child, not per invoice, so it counts the children who owe instead.
    { key: "owing", label: t("dashboard.ref.studentsWithDues"), value: brief.fees ? String(brief.fees.students_owing) : null, icon: FileWarning, hint: session },
    { key: "expenses", label: t("dashboard.ref.totalExpenses"), value: figures.expenses === null ? null : money(figures.expenses), icon: Receipt, hint: session },
    { key: "books", label: t("dashboard.ref.totalBooks"), value: n(figures.books), icon: BookOpen, hint: t("dashboard.ref.titles") },
    { key: "studentLeave", label: t("dashboard.ref.pendingStudentLeaves"), value: n(figures.pendingStudentLeave), icon: CalendarClock, hint: t("dashboard.ref.awaitingDecision") },
    { key: "staffLeave", label: t("dashboard.ref.pendingStaffLeaves"), value: n(figures.pendingStaffLeave), icon: CalendarX2, hint: t("dashboard.ref.awaitingDecision") },
  ];
}

/* --------------------------------------------------------------- skeletons */

function Block({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl border border-border bg-card ${className}`} />;
}

export function FiguresSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, i) => (
        <Block key={i} className="h-[90px]" />
      ))}
    </div>
  );
}

export function CalendarSkeleton() {
  return <Block className="h-[620px]" />;
}

export function ListsSkeleton() {
  return <Block className="h-[220px]" />;
}

export function ModulesSkeleton() {
  return <Block className="h-[480px]" />;
}

export function DetailSkeleton() {
  return <Block className="h-[640px]" />;
}
