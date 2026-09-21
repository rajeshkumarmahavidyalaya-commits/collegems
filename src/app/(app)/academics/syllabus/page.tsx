import Link from "next/link";
import { ArrowLeft, BookOpen, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { getBehindBy, getPace, listCourses, listSyllabusProblems } from "../syllabus-actions";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import {
  formatShare,
  paceRank,
  paceVerdict,
  PACE_VERDICT_LABEL,
  paceVerdictTone,
} from "@/lib/validations/syllabus-display";

export const metadata = { title: "Syllabus" };

/**
 * The pace of every course, and the courses themselves.
 *
 * A Server Component throughout — there is nothing here to click except links,
 * so the browser pays for none of it.
 *
 * The list is sorted by what needs doing rather than alphabetically: a screen
 * whose first row is "Grade 1 · A Art & Craft, on track" is one nobody scrolls.
 */
export default async function SyllabusPage() {
  const [ctx, pace, courses, problems, behindBy, locale] = await Promise.all([
    getUserContext(),
    getPace(),
    listCourses(),
    listSyllabusProblems(),
    getBehindBy(),
    getLocale(),
  ]);

  const rows = pace
    .map((row) => ({
      ...row,
      verdict: paceVerdict(row.shareCovered, row.shareElapsed, row.yearState, behindBy),
    }))
    .sort(
      (a, b) =>
        paceRank(a.verdict) - paceRank(b.verdict) ||
        a.sectionLabel.localeCompare(b.sectionLabel) ||
        a.subjectName.localeCompare(b.subjectName),
    );

  const tracked = rows.filter((r) => r.units > 0);
  const elapsed = rows[0]?.shareElapsed ?? null;
  const yearState = rows[0]?.yearState ?? "during";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/academics"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Academics
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Syllabus</h1>
        <p className="text-sm text-muted-foreground">
          What is in each course, and how much of it each class has covered — for{" "}
          {ctx?.currentSessionName ?? "the current session"}.{" "}
          {/* The year is a fact about the year, said once, rather than repeated
              in every row as a percentage nobody can compare against. */}
          {yearState === "ended"
            ? "That year has ended."
            : yearState === "before"
              ? "That year has not started yet."
              : `${formatShare(elapsed)} of the teaching year has passed.`}
        </p>
      </div>

      {/* Three states: null is "your role may not ask", empty is "asked, and
          there is nothing wrong". A blank space for both would be the failure
          the critic exists to remove. */}
      {problems && problems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
              What to look at
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {problems.map((p, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Badge variant={p.severity === "warning" ? "warning" : "secondary"} className="mt-0.5 shrink-0">
                  {p.severity}
                </Badge>
                <span>{p.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pace</CardTitle>
          <CardDescription>
            {tracked.length === 0
              ? "No course has a syllabus yet, so there is nothing to measure. Write one below and this fills in."
              : `${tracked.length} of ${rows.length} courses have a syllabus. What needs attention is first.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No class studies anything this year yet. Assign subjects to classes under Academics
              and each one becomes a course here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Class</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Subject</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Units</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Covered</th>
                    <th scope="col" className="py-2 pe-3 text-start font-medium">Last recorded</th>
                    <th scope="col" className="py-2 text-start font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.sectionId}:${row.subjectId}`} className="border-b last:border-0">
                      <td className="py-2 pe-3">{row.sectionLabel}</td>
                      <td className="py-2 pe-3">{row.subjectName}</td>
                      <td className="py-2 pe-3 font-mono tabular-nums text-muted-foreground">
                        {row.units === 0 ? "—" : `${row.unitsCovered}/${row.units}`}
                      </td>
                      {/* formatShare renders null as a dash. A `?? 0` here
                          would erase the distinction the module is built on. */}
                      <td className="py-2 pe-3 font-mono tabular-nums">
                        {formatShare(row.shareCovered)}
                      </td>
                      <td className="py-2 pe-3 text-muted-foreground">
                        {row.lastCoveredOn ? formatDate(row.lastCoveredOn, locale) : "—"}
                      </td>
                      <td className="py-2">
                        {/* Never colour alone. */}
                        <Badge variant={paceVerdictTone(row.verdict)}>
                          {PACE_VERDICT_LABEL[row.verdict]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
            Courses
          </CardTitle>
          <CardDescription>
            One syllabus per class and subject, however many classes study it. Open one to write it
            or to record what a class has covered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subjects are assigned to any class this year.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => (
                <Link
                  key={`${course.classLevelId}:${course.subjectId}`}
                  href={`/academics/syllabus/${course.classLevelId}/${course.subjectId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{course.subjectName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {course.classLevelName}
                    </span>
                  </span>
                  <Badge variant={course.units === 0 ? "outline" : "secondary"} className="shrink-0">
                    {course.units === 0
                      ? "No syllabus"
                      : `${course.units} unit${course.units === 1 ? "" : "s"}`}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
