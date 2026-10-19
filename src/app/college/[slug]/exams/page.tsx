import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { readTimetable, timeRange } from "@/lib/validations/public-pages";
import { loadCollege } from "../college";
import { PUBLIC_METADATA, PublicClosed, PublicShell } from "../public-shell";

export const metadata: Metadata = { title: "Exam timetable", ...PUBLIC_METADATA };

const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" };

/** The dated papers of every exam the college marked public, in this year (0361). */
export default async function ExamTimetablePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [college, t, locale, supabase] = await Promise.all([loadCollege(slug), getT(), getLocale(), createClient()]);
  if (!college?.pages.exam_timetable) return <PublicClosed college={college} />;
  const { data } = await supabase.rpc("public_exam_timetable", { p_slug: college.slug });
  const exams = readTimetable(data);
  if (!exams) return <PublicClosed college={college} />;

  return (
    <PublicShell college={college} title={t("public.exams.title")}>
      {exams.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
          {t("public.exams.empty")}
        </p>
      ) : (
        exams.map((exam) => (
          <section key={exam.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-5">
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold text-foreground">{exam.name}</h2>
              {exam.startsOn ? (
                <p className="text-sm text-muted-foreground">
                  {formatDate(exam.startsOn, locale, DAY)}
                  {exam.endsOn && exam.endsOn !== exam.startsOn ? ` – ${formatDate(exam.endsOn, locale, DAY)}` : null}
                </p>
              ) : null}
              {exam.centre ? (
                <p className="text-sm text-muted-foreground">{t("public.exams.centre", { centre: exam.centre })}</p>
              ) : null}
            </div>
            {exam.papers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("public.exams.noPapers")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pe-3 text-start font-medium">{t("public.exams.date")}</th>
                      <th className="py-2 pe-3 text-start font-medium">{t("public.exams.time")}</th>
                      <th className="py-2 pe-3 text-start font-medium">{t("public.exams.class")}</th>
                      <th className="py-2 text-start font-medium">{t("public.exams.subject")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exam.papers.map((p, i) => (
                      <tr key={`${p.className}-${p.subject}-${i}`} className="border-b border-border last:border-0">
                        <td className="py-2 pe-3 whitespace-nowrap">
                          {p.date ? formatDate(p.date, locale, DAY) : t("public.exams.notFixed")}
                        </td>
                        <td className="py-2 pe-3 whitespace-nowrap tabular-nums">
                          <bdi>{timeRange(p.startsAt, p.endsAt) ?? "—"}</bdi>
                        </td>
                        <td className="py-2 pe-3">{p.className}</td>
                        <td className="py-2">{p.subject}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}
    </PublicShell>
  );
}
