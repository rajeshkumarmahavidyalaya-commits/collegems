import Link from "next/link";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { getT } from "@/lib/i18n/server";

/**
 * The reference calendar's two buttons, Add Event and Add Holiday. An event
 * here is a notice and a holiday is kept on the academics screen, so each is a
 * link drawn on the permission that screen checks (rule 4).
 *
 * Kept out of the calendar page on purpose: what the calendar *shows* is
 * decided by `school_calendar()` and each source's policies, and the page
 * makes no role decision at all. This component reads nothing; it only
 * decides which links to draw (tests/parity/wpschool-parity.test.ts).
 */
export async function CalendarActions() {
  const [t, canNotices, canHolidays] = await Promise.all([
    getT(),
    hasPermission("notices.manage"),
    hasPermission("academics.manage"),
  ]);
  if (!canNotices && !canHolidays) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canNotices && (
        <Button asChild variant="outline">
          <Link href="/notices/manage">{t("calendar.addEvent")}</Link>
        </Button>
      )}
      {canHolidays && (
        <Button asChild variant="outline">
          <Link href="/academics?tab=holidays">{t("calendar.addHoliday")}</Link>
        </Button>
      )}
    </div>
  );
}
