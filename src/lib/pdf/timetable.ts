import { Sheet, pdfFileName, type Cell } from "./document";
import { formatWeekday } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

/**
 * A class's weekly routine, as a handout: the grid a family pins to the
 * fridge and a class teacher pins to the door.
 *
 * `docs/modules/timetable.md` listed "no printable routine": the grid printed
 * through the global stylesheet, but there was no per-class layout. This is
 * that layout, from the same read path the screen uses
 * (`timetable_for_section`, INVOKER), so the file cannot disagree with the
 * grid. Periods down the page, the school's teaching days across it; each
 * cell is the subject, and underneath it, quieter, the teacher and the room.
 */

export type RoutineDocumentInput = {
  school: { name: string; address: string };
  classLabel: string;
  yearLabel: string | null;
  weekdays: number[];
  slots: { id: string; periodNumber: number; label: string | null; startsAt: string; endsAt: string }[];
  entries: {
    weekday: number;
    timeSlotId: string;
    subjectName: string;
    teacherName: string | null;
    roomName: string | null;
  }[];
};

export type RoutineStrings = { heading: string; period: string; free: string };

export function routineFileName(classLabel: string): string {
  return pdfFileName(`routine-${classLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
}

const hhmm = (t: string) => t.slice(0, 5);

export async function renderRoutine(
  doc: RoutineDocumentInput,
  locale: Locale,
  s: RoutineStrings,
): Promise<Uint8Array> {
  const sheet = await Sheet.create({ locale });

  sheet.text(doc.school.name, { size: 15, leading: 1.25 });
  if (doc.school.address) sheet.text(doc.school.address, { size: 9, leading: 1.35, tone: "quiet", above: 2 });
  sheet.rule(12, 14);
  sheet.row(
    [
      { text: `${s.heading} · ${doc.classLabel}`, width: 0.7 },
      { text: doc.yearLabel ?? "", width: 0.3, align: "end" },
    ],
    { size: 12 },
  );

  // The first column carries the period; the days share what is left.
  const first = 0.16;
  const day = (1 - first) / Math.max(doc.weekdays.length, 1);
  const short = doc.weekdays.length > 5;

  sheet.rule(10, 2);
  sheet.row(
    [
      { text: s.period, width: first },
      ...doc.weekdays.map((d): Cell => ({ text: formatWeekday(d, locale, short ? "short" : "long"), width: day })),
    ],
    { size: 9, tone: "quiet", gap: 6 },
  );
  sheet.rule(4, 2);

  const at = new Map(doc.entries.map((e) => [`${e.weekday}:${e.timeSlotId}`, e]));
  for (const slot of doc.slots) {
    const name = slot.label?.trim() || `${s.period} ${slot.periodNumber}`;
    sheet.row(
      [
        { text: name, width: first },
        ...doc.weekdays.map((d): Cell => ({ text: at.get(`${d}:${slot.id}`)?.subjectName ?? s.free, width: day })),
      ],
      { size: 9, gap: 6 },
    );
    sheet.row(
      [
        { text: `${hhmm(slot.startsAt)}–${hhmm(slot.endsAt)}`, width: first },
        ...doc.weekdays.map((d): Cell => {
          const e = at.get(`${d}:${slot.id}`);
          return { text: e ? [e.teacherName, e.roomName].filter(Boolean).join(" · ") : "", width: day };
        }),
      ],
      { size: 7.5, tone: "quiet", leading: 1.4, gap: 6 },
    );
    sheet.rule(3, 2);
  }

  return sheet.finish(`${doc.classLabel}${doc.yearLabel ? ` · ${doc.yearLabel}` : ""}`);
}
