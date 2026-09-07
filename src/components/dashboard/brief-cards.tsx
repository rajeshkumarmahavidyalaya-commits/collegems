import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/validations/fees";
import {
  collectionRate,
  staffRegisterReading,
  studentRegisterReading,
  type DashboardSummary,
  type RegisterState,
} from "@/lib/validations/dashboard";

/**
 * The home page's cards. Server components — the brief is already resolved by
 * the time it gets here, so none of this needs to be interactive.
 *
 * Every card in this file obeys the same two rules, and they are the ones that
 * make a dashboard trustworthy rather than decorative:
 *
 *   - **A missing number is a sentence, not a zero.** "Nobody has taken the
 *     register" and "0% present" look the same on a card and mean opposite
 *     things, so the register cards render a `RegisterState` rather than a
 *     percentage that might be a lie.
 *   - **Every card says where to go next.** A figure somebody cannot act on is
 *     a figure they stop reading, so each card links to the screen that can do
 *     something about it.
 */

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

function BriefCard({
  title,
  description,
  icon: Icon,
  href,
  hrefLabel,
  children,
  className,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  hrefLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{title}</span>
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          <Link
            href={href}
            className="shrink-0 rounded-md text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="inline-flex items-center gap-1">
              {hrefLabel}
              <ArrowRight className="size-3 rtl:rotate-180" aria-hidden="true" />
            </span>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}

/** A label/number pair. `tabular-nums` so a column of them does not jitter. */
function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted" | "danger" | "success";
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          tone === "muted" && "text-muted-foreground",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * A proportion, drawn. `role="img"` with the label spelled out, because the
 * bar itself is decoration — the number beside it is the information, and a
 * screen reader should get the number rather than a described rectangle.
 */
function Meter({ percent, label, tone }: { percent: number; label: string; tone: string }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ inlineSize: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

/** The one place a register's three states become words. */
function registerHeadline(state: RegisterState): { value: string; note: string } {
  switch (state.kind) {
    case "holiday":
      return { value: "Holiday", note: "Not a working day — no register expected" };
    case "not-taken":
      return { value: "Not taken", note: "Nobody has been marked yet today" };
    case "taken":
      return { value: `${state.percent}%`, note: "Of those marked so far" };
  }
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

export function StudentRegisterCard({
  register,
  icon,
}: {
  register: NonNullable<DashboardSummary["student_attendance"]>;
  icon: LucideIcon;
}) {
  const state = studentRegisterReading(register);
  const headline = registerHeadline(state);

  return (
    <BriefCard
      title="Students in today"
      description={headline.note}
      icon={icon}
      href="/attendance"
      hrefLabel="Register"
    >
      <div className="flex flex-col gap-3">
        <p className="font-mono text-3xl font-semibold tabular-nums">{headline.value}</p>
        {state.kind === "taken" && (
          <Meter
            percent={state.percent}
            label={`${state.percent}% of marked students present`}
            tone={state.percent >= 85 ? "bg-success" : "bg-warning"}
          />
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Present" value={String(register.present)} />
          <Figure label="Absent" value={String(register.absent)} tone={register.absent > 0 ? "danger" : undefined} />
          <Figure label="Late" value={String(register.late)} />
          <Figure label="Marked" value={String(register.marked)} tone="muted" />
        </dl>
      </div>
    </BriefCard>
  );
}

export function StaffRegisterCard({
  register,
  icon,
}: {
  register: NonNullable<DashboardSummary["staff_attendance"]>;
  icon: LucideIcon;
}) {
  const state = staffRegisterReading(register);
  const headline = registerHeadline(state);
  const unmarked = Math.max(0, register.roll - register.marked);

  return (
    <BriefCard
      title="Teachers and staff in today"
      description={headline.note}
      icon={icon}
      href="/hr"
      hrefLabel="Register"
    >
      <div className="flex flex-col gap-3">
        <p className="font-mono text-3xl font-semibold tabular-nums">{headline.value}</p>
        {state.kind === "taken" && (
          <Meter
            percent={state.percent}
            label={`${state.percent}% of marked staff present`}
            tone={state.percent >= 85 ? "bg-success" : "bg-warning"}
          />
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="Present" value={String(register.present)} />
          <Figure label="Absent" value={String(register.absent)} tone={register.absent > 0 ? "danger" : undefined} />
          <Figure label="Half day" value={String(register.half_day)} />
          <Figure label="On leave" value={String(register.on_leave)} />
          <Figure label="On duty" value={String(register.on_duty)} />
          {/* The figure the roll count exists for: a register that is 100%
              present because thirty-nine people were never marked. */}
          <Figure label="Unmarked" value={`${unmarked} of ${register.roll}`} tone="muted" />
        </dl>
      </div>
    </BriefCard>
  );
}

export function FeesCard({
  fees,
  icon,
}: {
  fees: NonNullable<DashboardSummary["fees"]>;
  icon: LucideIcon;
}) {
  const rate = collectionRate(fees);

  return (
    <BriefCard
      title="Fees"
      description={
        rate === null
          ? "Nothing has been billed yet this session"
          : `${rate}% of what has been billed is in`
      }
      icon={icon}
      href="/fees"
      hrefLabel="Collect"
    >
      <div className="flex flex-col gap-3">
        <p className="font-mono text-3xl font-semibold tabular-nums">
          {formatMoney(fees.outstanding)}
        </p>
        <p className="text-xs text-muted-foreground">
          Outstanding across {fees.students_owing}{" "}
          {fees.students_owing === 1 ? "student" : "students"}
        </p>
        {rate !== null && (
          <Meter
            percent={rate}
            label={`${rate}% of billed fees collected`}
            tone={rate >= 85 ? "bg-success" : "bg-primary"}
          />
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Billed" value={formatMoney(fees.billed)} tone="muted" />
          <Figure label="Collected" value={formatMoney(fees.collected)} tone="success" />
          <Figure label="In today" value={formatMoney(fees.collected_today)} />
          <Figure label="Receipts today" value={String(fees.receipts_today)} tone="muted" />
        </dl>
      </div>
    </BriefCard>
  );
}

export function ExamCard({
  exam,
  icon,
}: {
  exam: DashboardSummary["exam"];
  icon: LucideIcon;
}) {
  // Null is not an error and not a zero: no exam has been published yet, and a
  // pass rate of 0% would be a lie about exactly the term somebody is looking
  // at. See `dashboard_summary()`.
  if (!exam) {
    return (
      <BriefCard
        title="Results"
        description="No exam has been published yet"
        icon={icon}
        href="/exams"
        hrefLabel="Exams"
      >
        <p className="py-4 text-sm text-muted-foreground">
          Pass and fail counts appear here once an exam&rsquo;s results are published. Marks entered
          against an unpublished exam are still provisional and are deliberately not counted.
        </p>
      </BriefCard>
    );
  }

  const decided = exam.passed + exam.failed;

  return (
    <BriefCard
      title="Results"
      description={exam.name}
      icon={icon}
      href="/reports"
      hrefLabel="Full report"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-mono text-3xl font-semibold tabular-nums">
            {exam.pass_percent === null ? "—" : `${exam.pass_percent}%`}
          </p>
          <Badge variant={(exam.pass_percent ?? 0) >= 85 ? "success" : "warning"}>
            {exam.pass_percent === null ? "Not graded" : "Passed"}
          </Badge>
        </div>
        {decided > 0 && (
          <Meter
            percent={Math.round((exam.passed / decided) * 100)}
            label={`${exam.passed} passed of ${decided} graded`}
            tone="bg-success"
          />
        )}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Passed" value={String(exam.passed)} tone="success" />
          <Figure label="Failed" value={String(exam.failed)} tone={exam.failed > 0 ? "danger" : undefined} />
          <Figure label="Incomplete" value={String(exam.incomplete)} tone="muted" />
          <Figure
            label="Average"
            value={exam.average_percent === null ? "—" : `${exam.average_percent}%`}
          />
        </dl>
      </div>
    </BriefCard>
  );
}

export function LibraryCard({
  library,
  icon,
}: {
  library: NonNullable<DashboardSummary["library"]>;
  icon: LucideIcon;
}) {
  return (
    <BriefCard
      title="Library"
      description={
        library.overdue === 0 ? "Nothing is overdue" : `${library.overdue} overdue right now`
      }
      icon={icon}
      href="/library/issues"
      hrefLabel="Issues"
    >
      <dl className="grid grid-cols-2 gap-3">
        <Figure label="Out on loan" value={String(library.issued)} />
        <Figure
          label="Overdue"
          value={String(library.overdue)}
          tone={library.overdue > 0 ? "danger" : "success"}
        />
      </dl>
    </BriefCard>
  );
}
