import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import { UnrenderableDocument } from "@/lib/pdf/document";
import { renderRoutine, routineFileName } from "@/lib/pdf/timetable";
import { getSectionRoutine, listLessonSlots, listTeachingWeekdays } from "../actions";
import { getSchoolProfile } from "../../fees/actions";

/**
 * A class's weekly routine as a file: `/timetable/pdf?section=<id>`.
 *
 * No permission check of its own, for the reason the single report card has
 * none: every read here is RLS-scoped, and the routine is exactly what the
 * caller's own timetable screen already shows them. A section the caller
 * cannot see reads as no section, and the 404 says nothing about which.
 */
export async function GET(request: Request) {
  const sectionId = new URL(request.url).searchParams.get("section");
  const notFound = () =>
    new Response("Not available.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (!sectionId) return notFound();

  const supabase = await createClient();
  const { data: section } = await supabase
    .from("sections")
    .select("id, name, class_levels ( name ), academic_sessions ( name )")
    .eq("id", sectionId)
    .maybeSingle();
  if (!section) return notFound();

  const [entries, slots, weekdays, profile, { data: tenant }, t, locale] = await Promise.all([
    getSectionRoutine(sectionId),
    listLessonSlots(),
    listTeachingWeekdays(),
    getSchoolProfile(),
    supabase.from("tenants").select("name").limit(1).maybeSingle(),
    getT(),
    getLocale(),
  ]);

  const level = Array.isArray(section.class_levels) ? section.class_levels[0] : section.class_levels;
  const year = Array.isArray(section.academic_sessions) ? section.academic_sessions[0] : section.academic_sessions;
  const classLabel = level ? `${level.name} · ${section.name}` : section.name;

  try {
    const bytes = await renderRoutine(
      {
        school: {
          name: tenant?.name ?? "",
          address: [profile.addressLine1, profile.city, profile.state].filter(Boolean).join(", "),
        },
        classLabel,
        yearLabel: year?.name ?? null,
        // Monday to Saturday at most: a routine is the teaching week.
        weekdays: weekdays.filter((d) => d <= 6),
        slots: slots.filter((s) => !s.isBreak),
        entries,
      },
      locale,
      { heading: t("pdf.routine.heading"), period: t("timetable.periodBare"), free: "—" },
    );
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${routineFileName(classLabel)}"`,
        // A routine changes whenever the office edits the grid.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnrenderableDocument) {
      return new Response(error.message, { status: 422, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }
}
