import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { statusLabel } from "@/lib/validations/attendance-display";
import { getAttendance } from "../actions";
import { EmptyCard, FamilyFrame } from "../family-frame";
import { loadFamilyPage } from "../load";

export const metadata = { title: "Attendance" };

function monthName(key: string, locale: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * The child's own daily register this year: a line a month with totals, and
 * the days of the chosen month. The percentage is over the days marked, and
 * the number of days marked sits beside it, so a register nobody took never
 * reads as a good month (rule 12).
 */
export default async function FamilyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; month?: string }>;
}) {
  const { child: requested, month } = await searchParams;
  const { isFamily, childList, child, locale } = await loadFamilyPage(requested);
  const [t, data] = await Promise.all([
    getT(),
    child ? getAttendance(child.studentId, month ?? null) : Promise.resolve({ months: [], days: [], month: null }),
  ]);
  const pct = (present: number, late: number, marked: number) =>
    marked === 0 ? "—" : `${(((present + late) / marked) * 100).toFixed(1)}%`;

  return (
    <FamilyFrame title="Attendance" icon={CalendarCheck} isFamily={isFamily} childList={childList} child={child}>
      {data.months.length === 0 ? (
        <EmptyCard
          icon={CalendarCheck}
          title="No register has been taken for this child this year"
          body="Once the class teacher takes the register, each day appears here."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-end">Days Marked</TableHead>
                  <TableHead className="text-end">Present</TableHead>
                  <TableHead className="text-end">Absent</TableHead>
                  <TableHead className="text-end">Late</TableHead>
                  <TableHead className="text-end">Excused</TableHead>
                  <TableHead className="text-end">Attendance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((m) => (
                  <TableRow key={m.month} data-state={m.month === data.month ? "selected" : undefined}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/family/attendance?month=${m.month}${child ? `&child=${child.studentId}` : ""}`}
                        className="text-primary underline-offset-4 hover:underline"
                        aria-current={m.month === data.month ? "page" : undefined}
                      >
                        {monthName(m.month, locale)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{m.marked}</TableCell>
                    <TableCell className="text-end tabular-nums">{m.present}</TableCell>
                    <TableCell className="text-end tabular-nums">{m.absent}</TableCell>
                    <TableCell className="text-end tabular-nums">{m.late}</TableCell>
                    <TableCell className="text-end tabular-nums">{m.excused}</TableCell>
                    <TableCell className="text-end tabular-nums">{pct(m.present, m.late, m.marked)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data.month && (
            <section aria-labelledby="days-heading" className="flex flex-col gap-2">
              <h2 id="days-heading" className="text-base font-semibold">
                {monthName(data.month, locale)}
              </h2>
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.days.map((d) => (
                      <TableRow key={d.date}>
                        <TableCell>{formatDate(d.date, locale)}</TableCell>
                        <TableCell>
                          <Badge variant={d.status === "absent" ? "destructive" : d.status === "present" ? "default" : "secondary"}>
                            {statusLabel(d.status, t)}
                          </Badge>
                        </TableCell>
                        <TableCell>{d.note ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </>
      )}
    </FamilyFrame>
  );
}
