import { hasPermission } from "@/lib/auth/permissions";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDateTime, formatTime } from "@/lib/i18n/format";
import { JOIN_OPENS_MINUTES_BEFORE } from "@/lib/validations/live-classes-display";
import { listCourses, listLessons, type Lesson } from "./actions";
import { LessonList, ScheduleButton, type ShownLesson } from "./lessons-view";

export const metadata = { title: "Live classes" };

/**
 * Live lessons: the last week and the next two, with the link to join each.
 *
 * One screen for every seat, and **no branch on who is looking**: RLS decides
 * which lessons come back (a family's own children's classes, a teacher's own
 * courses and their form's), `live_classes_between` says per row whether the
 * caller may cancel it, and `liveclasses.manage` decides only whether the
 * Schedule button is drawn.
 *
 * **Times are written where the college is.** A Server Component on Vercel runs
 * in UTC, so `formatDateTime` is handed the college's own `timeZone` with every
 * lesson -- a 10:00 lesson in Kolkata is stored as 04:30 UTC and would
 * otherwise be shown to every family as half past four in the morning.
 */
export default async function LiveClassesPage() {
  const [canView, canManage, t, locale] = await Promise.all([
    hasPermission("liveclasses.view"),
    hasPermission("liveclasses.manage"),
    getT(),
    getLocale(),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("liveClasses.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("liveClasses.noAccess")}</p>
      </div>
    );
  }

  const [lessons, courses] = await Promise.all([
    listLessons(),
    canManage ? listCourses() : Promise.resolve([]),
  ]);

  const show = (l: Lesson): ShownLesson => {
    const zone = { timeZone: l.timezone };
    const opens = new Date(Date.parse(l.startsAt) - JOIN_OPENS_MINUTES_BEFORE * 60_000);
    return {
      ...l,
      when: `${formatDateTime(l.startsAt, locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        ...zone,
      })} – ${formatTime(l.endsAt, locale, { hour: "2-digit", minute: "2-digit", ...zone })}`,
      opensAt: formatTime(opens, locale, { hour: "2-digit", minute: "2-digit", ...zone }),
    };
  };

  // Split on the instant the page was rendered; the Join buttons themselves
  // re-check every half minute in the browser.
  const now = Date.now();
  const upcoming = lessons.filter((l) => Date.parse(l.endsAt) > now).map(show);
  const earlier = lessons
    .filter((l) => Date.parse(l.endsAt) <= now)
    .reverse()
    .map(show);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("liveClasses.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("liveClasses.subtitle")}</p>
        </div>
        {canManage ? <ScheduleButton courses={courses} /> : null}
      </div>

      <section aria-labelledby="upcoming-heading" className="flex flex-col gap-3">
        <h2 id="upcoming-heading" className="text-lg font-semibold">
          {t("liveClasses.upcoming")}
        </h2>
        <LessonList lessons={upcoming} emptyText={t("liveClasses.empty")} />
      </section>

      {earlier.length > 0 ? (
        <section aria-labelledby="earlier-heading" className="flex flex-col gap-3">
          <h2 id="earlier-heading" className="text-lg font-semibold">
            {t("liveClasses.earlier")}
          </h2>
          <LessonList lessons={earlier} emptyText="" />
        </section>
      ) : null}
    </div>
  );
}
