import Link from "next/link";
import { ArrowRight, Bus, CalendarCheck, GraduationCap, Megaphone, Wallet } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SchoolCalendar } from "@/components/dashboard/school-calendar";
import type { FamilyChild } from "@/lib/auth/family";
import type { Locale } from "@/lib/i18n/config";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { frequencyLabel } from "@/lib/validations/fees-display";
import { getFamilyHome } from "./actions";
import { FamilyFrame } from "./family-frame";

/**
 * The reference's Student (or Parent) Dashboard: who the child is, what the
 * year costs and what is paid, the register, the bus, the latest notices and
 * the calendar.
 *
 * It replaces the staff dashboard for a family, which showed them the
 * college's cards with their own rows in them ("Students with Dues: 1" was
 * their own child). That is a decision about what is shown, so it is made on
 * the tier (0208); what the family may read is still decided row by row in
 * Postgres, by RLS and by `family_owns_student`.
 */
export async function FamilyHome({
  childList,
  child,
  sessionId,
  sessionName,
  today,
  month,
  locale,
  isParent,
}: {
  childList: FamilyChild[];
  child: FamilyChild | null;
  sessionId: string | null;
  sessionName: string | null;
  today: string;
  month?: string;
  locale: Locale;
  isParent: boolean;
}) {
  const title = isParent ? "Parent Dashboard" : "Student Dashboard";
  if (!child) {
    return (
      <FamilyFrame title={title} icon={GraduationCap} isFamily childList={childList} child={null}>
        {null}
      </FamilyFrame>
    );
  }
  const [t, home] = await Promise.all([getT(), getFamilyHome(child, { id: sessionId, name: sessionName })]);
  const q = `?child=${child.studentId}`;
  const att = home.attendance;
  const share = (n: number) => (att.marked === 0 ? 0 : (n / att.marked) * 100);
  const pct = att.marked === 0 ? null : ((att.present + att.late) / att.marked) * 100;
  const primary = home.guardians.find((g) => g.isPrimary) ?? home.guardians[0] ?? null;
  const initials = child.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const structureTotal = home.feeLines.reduce((s, l) => s + (l.sessionTotal ?? 0), 0);

  return (
    <FamilyFrame title={title} icon={GraduationCap} isFamily childList={childList} child={child}>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start">
          <Avatar className="size-20 rounded-lg">
            {home.photo && <AvatarImage src={home.photo} alt="" />}
            <AvatarFallback className="rounded-lg text-lg">{initials}</AvatarFallback>
          </Avatar>
          <dl className="grid flex-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Name" value={child.name} />
            <Fact label="Admission Number" value={child.admissionNumber} />
            <Fact label="Session" value={home.sessionName} />
            <Fact label="Class" value={child.sectionLabel} />
            <Fact label="Roll Number" value={child.rollNumber} />
            {primary && (
              <Fact
                label={primary.relationship ? `${primary.relationship[0].toUpperCase()}${primary.relationship.slice(1)}` : "Guardian"}
                value={[primary.name, primary.phone].filter(Boolean).join(" · ") || null}
              />
            )}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
              Session Fee Summary
            </CardTitle>
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href={`/fees/family${q}`}>
                Invoices <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fee Types</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-end">Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {home.feeLines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground">
                      No fees are set for this class this year.
                    </TableCell>
                  </TableRow>
                ) : (
                  home.feeLines.map((l) => (
                    <TableRow key={l.feeHeadId}>
                      <TableCell>{l.feeHead}</TableCell>
                      <TableCell>{frequencyLabel(l.frequency, t)}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {l.sessionTotal === null ? "—" : formatCurrency(l.sessionTotal, locale)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              <TableFooter>
                <SumRow label="Fee structure for the year" value={formatCurrency(structureTotal, locale)} />
                <SumRow label="Charged this year" value={formatCurrency(home.fees.charged, locale)} />
                <SumRow label="Concession" value={`− ${formatCurrency(home.fees.concessions, locale)}`} />
                <SumRow label="Paid" value={formatCurrency(home.fees.paid, locale)} tone="text-success" />
                <SumRow label="Balance due" value={formatCurrency(home.fees.balance, locale)} strong />
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                Attendance {pct === null ? "" : `${pct.toFixed(1)}%`}
              </CardTitle>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={`/family/attendance${q}`}>
                  By month <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {att.marked === 0 ? (
                <p className="text-sm text-muted-foreground">No register has been taken for this child this year.</p>
              ) : (
                <>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className="bg-success" style={{ width: `${share(att.present)}%` }} />
                    <span className="bg-destructive" style={{ width: `${share(att.absent)}%` }} />
                    <span className="bg-warning" style={{ width: `${share(att.late)}%` }} />
                    <span className="bg-muted-foreground" style={{ width: `${share(att.excused)}%` }} />
                  </div>
                  <ul className="mt-3 grid grid-cols-2 gap-1 text-sm">
                    <li>Present: {att.present} ({share(att.present).toFixed(0)}%)</li>
                    <li>Absent: {att.absent} ({share(att.absent).toFixed(0)}%)</li>
                    <li>Late: {att.late} ({share(att.late).toFixed(0)}%)</li>
                    <li>Excused: {att.excused} ({share(att.excused).toFixed(0)}%)</li>
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">Over the {att.marked} days a register was taken.</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bus className="size-4 text-muted-foreground" aria-hidden="true" />
                Transportation
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {home.transport ? (
                <dl className="grid gap-1">
                  <Fact label="Route" value={home.transport.route} />
                  <Fact label="Stop" value={home.transport.stop} />
                  <Fact label="Vehicle" value={home.transport.vehicle} />
                  <Fact label="Fare a month" value={home.transport.fare === null ? null : formatCurrency(home.transport.fare, locale)} />
                  {(home.transport.pickup || home.transport.drop) && (
                    <Fact
                      label="Times"
                      value={[home.transport.pickup && `pickup ${home.transport.pickup.slice(0, 5)}`, home.transport.drop && `drop ${home.transport.drop.slice(0, 5)}`]
                        .filter(Boolean)
                        .join(", ")}
                    />
                  )}
                </dl>
              ) : (
                <p className="text-muted-foreground">No bus seat this year.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4 text-muted-foreground" aria-hidden="true" />
            Latest Notices
          </CardTitle>
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link href="/notices">
              All notices <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {home.notices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notices yet.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {home.notices.map((n) => (
                <li key={n.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    {n.publishedAt ? formatDate(n.publishedAt, locale) : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/notices/${n.id}`} className="font-medium underline-offset-4 hover:underline">
                      {n.title}
                    </Link>
                    <p className="line-clamp-1 text-sm text-muted-foreground">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <SchoolCalendar today={today} month={month} locale={locale} />
    </FamilyFrame>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-1">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}

function SumRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <TableRow>
      <TableCell colSpan={2} className={strong ? "font-semibold" : "font-normal"}>
        {label}
      </TableCell>
      <TableCell className={`text-end tabular-nums ${strong ? "font-semibold" : "font-normal"} ${tone ?? ""}`}>{value}</TableCell>
    </TableRow>
  );
}
