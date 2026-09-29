import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, GraduationCap, IndianRupee, Megaphone, Palmtree } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { groupByDay, kindLabel, monthWindow, type CalendarEntry } from "@/lib/validations/calendar";

export const metadata = { title: "School calendar" };

const ICONS = { holiday: Palmtree, exam: GraduationCap, fee_due: IndianRupee, notice: Megaphone } as const;

/**
 * The school's month (0297): holidays, exams, fee due dates and notices, the
 * dates the school already keeps, in one place. Nothing here is a new record:
 * every entry is owned by its module and links back to it.
 *
 * `school_calendar()` is an invoker, so what a seat sees is what each
 * source's own policies allow -- there is no role check in this file.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ month }, locale, t, supabase] = await Promise.all([searchParams, getLocale(), getT(), createClient()]);
  const { data: today } = await supabase.rpc("mobile_today");
  const schoolDay = (today as string | null) ?? new Date().toISOString().slice(0, 10);
  const win = monthWindow(month, schoolDay);

  const { data, error } = await supabase.rpc("school_calendar", { p_from: win.from, p_to: win.to });
  const days = groupByDay((data ?? []) as CalendarEntry[], win.from);
  const title = formatDate(win.from, locale, { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("calendar.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("calendar.intro")}</p>
        </div>
        <nav aria-label={t("calendar.month")} className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon">
            <Link href={`/calendar?month=${win.prev}`} aria-label={t("calendar.previous")}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <span className="min-w-36 text-center font-medium">{title}</span>
          <Button asChild variant="outline" size="icon">
            <Link href={`/calendar?month=${win.next}`} aria-label={t("calendar.next")}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </nav>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("calendar.error", { message: error.message })}
        </p>
      ) : days.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <CalendarDays className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="font-medium">{t("calendar.emptyTitle", { month: title })}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("calendar.emptyBody")}</p>
          </CardContent>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {days.map(([day, entries]) => (
            <li key={day} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[9rem_1fr]">
              <p className={`text-sm font-medium ${day === schoolDay ? "text-primary" : ""}`}>
                {formatDate(day, locale, { weekday: "short", day: "numeric", month: "short" })}
                {day === schoolDay && <span className="ms-2 text-xs">{t("calendar.today")}</span>}
              </p>
              <ul className="flex flex-col gap-2">
                {entries.map((e, i) => {
                  const Icon = ICONS[e.kind as keyof typeof ICONS] ?? CalendarDays;
                  const until =
                    e.ends_on && e.ends_on !== e.starts_on
                      ? ` · ${t("calendar.until", { date: formatDate(e.ends_on, locale, { day: "numeric", month: "short" }) })}`
                      : "";
                  const body = (
                    <span className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <Badge variant={e.kind === "holiday" ? "success" : e.kind === "fee_due" ? "warning" : "secondary"}>
                        {kindLabel(e.kind, t)}
                      </Badge>
                      <span className="font-medium">{e.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {e.detail ?? ""}
                        {until}
                      </span>
                    </span>
                  );
                  return (
                    <li key={`${e.kind}-${e.title}-${i}`}>
                      {e.href ? (
                        <Link href={e.href} className="rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
