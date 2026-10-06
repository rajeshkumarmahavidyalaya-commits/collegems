import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { formatMonth, formatWeekday } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { kindLabel, monthWindow, type CalendarEntry } from "@/lib/validations/calendar";

/** Sunday first, as the reference draws its month. ISO weekday numbers. */
const COLUMNS = [7, 1, 2, 3, 4, 5, 6];

/**
 * The reference's month grid over `school_calendar()` -- the same invoker read
 * the agenda uses, so a seat sees exactly what each module's policies allow.
 * Entries arrive from the caller; this component asks nothing of the database.
 * Dates stay ISO strings, compared as strings (calendar.ts).
 */
export async function MonthCalendar({
  today,
  month,
  entries,
  basePath = "/calendar",
  locale,
}: {
  today: string;
  month?: string;
  entries: CalendarEntry[];
  basePath?: string;
  locale: Locale;
}) {
  const t = await getT();
  const win = monthWindow(month, today);
  const [year, monthNo] = win.month.split("-").map(Number);
  const lastDay = Number(win.to.slice(-2));
  const offset = new Date(Date.UTC(year, monthNo - 1, 1)).getUTCDay();
  const weeks = Math.ceil((offset + lastDay) / 7);
  const title = formatMonth(win.from, locale);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <section aria-label={t("calendar.gridTitle")}>
      <h2 className="flex items-center gap-2 border-b pb-2 font-medium">
        <CalendarDays className="size-5" aria-hidden="true" />
        {t("calendar.gridTitle")}
      </h2>
      <div className="reference-calendar-controls">
        <nav className="flex items-center gap-2" aria-label={t("calendar.monthNav")}>
          <Button asChild variant="outline" size="icon" className="size-7">
            <Link href={`${basePath}?month=${win.prev}`} aria-label={t("calendar.previous")}>
              <ChevronLeft className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <span className="min-w-28 text-center text-sm font-semibold">{title}</span>
          <Button asChild variant="outline" size="icon" className="size-7">
            <Link href={`${basePath}?month=${win.next}`} aria-label={t("calendar.next")}>
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-7">
            <Link href={basePath}>{t("calendar.today")}</Link>
          </Button>
        </nav>
        <ul className="reference-calendar-legend">
          <li data-kind="exam">{kindLabel("exam", t)}</li>
          <li data-kind="notice">{t("calendar.legend.notice")}</li>
          <li data-kind="holiday">{kindLabel("holiday", t)}</li>
          <li data-kind="fee_due">{kindLabel("fee_due", t)}</li>
        </ul>
      </div>
      {/* `relative` makes the scroller the containing block for the cells'
          sr-only labels: absolutely positioned against an ancestor outside it,
          they escaped the clip and widened every page with a calendar by 53px
          at 375px (6 Oct 2026). */}
      <div className="relative overflow-x-auto">
        <table className="reference-calendar" aria-label={title}>
          <thead>
            <tr>
              {COLUMNS.map((d) => (
                <th key={d} scope="col">
                  {formatWeekday(d, locale, "short")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: weeks }, (_, week) => (
              <tr key={week}>
                {Array.from({ length: 7 }, (_, day) => {
                  const n = week * 7 + day - offset + 1;
                  if (n < 1 || n > lastDay) return <td key={day} />;
                  const iso = `${win.month}-${pad(n)}`;
                  const events = entries.filter((e) => e.starts_on <= iso && (e.ends_on || e.starts_on) >= iso);
                  return (
                    <td key={day} aria-current={iso === today ? "date" : undefined}>
                      <time dateTime={iso}>{n}</time>
                      {events.map((e, i) => {
                        const label = `${kindLabel(e.kind, t)}: ${e.title}`;
                        return e.href ? (
                          <Link className="reference-calendar-event" data-kind={e.kind} href={e.href} key={i} title={e.detail ?? label}>
                            <span className="sr-only">{kindLabel(e.kind, t)}: </span>
                            {e.title}
                          </Link>
                        ) : (
                          <span className="reference-calendar-event" data-kind={e.kind} key={i} title={e.detail ?? label}>
                            <span className="sr-only">{kindLabel(e.kind, t)}: </span>
                            {e.title}
                          </span>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
          <CalendarDays className="size-9" aria-hidden="true" />
          <p className="text-xs">{t("calendar.emptyMonth")}</p>
        </div>
      )}
    </section>
  );
}
