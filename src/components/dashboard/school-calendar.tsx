import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/config";
import { monthWindow, type CalendarEntry } from "@/lib/validations/calendar";
import { MonthCalendar } from "@/components/calendar/month-calendar";

/** The dashboard's month, from the same invoker read as /calendar (0297). */
export async function SchoolCalendar({ today, month, locale }: { today: string; month?: string; locale: Locale }) {
  const [supabase, t] = await Promise.all([createClient(), getT()]);
  const win = monthWindow(month, today);
  const { data, error } = await supabase.rpc("school_calendar", { p_from: win.from, p_to: win.to });
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("calendar.error", { message: error.message })}
      </p>
    );
  }
  return (
    <MonthCalendar today={today} month={month} locale={locale} entries={(data ?? []) as CalendarEntry[]} basePath="/" />
  );
}
