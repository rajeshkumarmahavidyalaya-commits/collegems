import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { getUserContext } from "@/lib/auth/context";
import {
  getCoverage,
  listCourseSections,
  listCourses,
  listUnits,
} from "../../../syllabus-actions";
import { CourseEditor } from "./course-editor";

export const metadata = { title: "Course syllabus" };

/**
 * One course: its syllabus, and what one class has covered of it.
 *
 * The two halves are deliberately on one screen and gated separately. Writing
 * the syllabus is `academics.manage` — course setup, like creating a class.
 * Recording what was taught is `syllabus.track` plus actually teaching that
 * class, which the database decides; the page only draws the controls.
 */
export default async function CourseSyllabusPage({
  params,
  searchParams,
}: {
  params: Promise<{ classLevelId: string; subjectId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { classLevelId, subjectId } = await params;
  const { section } = await searchParams;

  const [courses, units, sections, ctx, canManage, canTrack] = await Promise.all([
    listCourses(),
    listUnits(classLevelId, subjectId),
    listCourseSections(classLevelId),
    getUserContext(),
    hasPermission("academics.manage"),
    hasPermission("syllabus.track"),
  ]);

  const course = courses.find(
    (c) => c.classLevelId === classLevelId && c.subjectId === subjectId,
  );
  if (!course) notFound();

  // A section named in the URL that is not of this class level is not an
  // error to shout about — it is a stale link. Fall back to the first class.
  const chosen = sections.find((s) => s.id === section) ?? sections[0] ?? null;
  const coverage = chosen ? await getCoverage(chosen.id, subjectId) : [];

  const plannedPeriods = units.reduce((n, u) => n + u.plannedPeriods, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/academics/syllabus"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Syllabus
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          {course.subjectName} · {course.classLevelName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {units.length === 0
            ? "No syllabus yet."
            : `${units.length} unit${units.length === 1 ? "" : "s"}, ${plannedPeriods} lesson${plannedPeriods === 1 ? "" : "s"} planned.`}{" "}
          One syllabus for {course.classLevelName}, however many classes study it — each class
          covers it at its own pace, in {ctx?.currentSessionName ?? "the current session"}.
        </p>
      </div>

      {sections.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No class studies this yet</CardTitle>
            <CardDescription>
              A syllabus can still be written, but there is nobody to record coverage against until
              a class of {course.classLevelName} exists this year.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CourseEditor
              classLevelId={classLevelId}
              subjectId={subjectId}
              units={units}
              sections={[]}
              chosenSectionId={null}
              coverage={[]}
              canManage={canManage}
              canTrack={false}
            />
          </CardContent>
        </Card>
      ) : (
        <CourseEditor
          classLevelId={classLevelId}
          subjectId={subjectId}
          units={units}
          sections={sections}
          chosenSectionId={chosen?.id ?? null}
          coverage={coverage}
          canManage={canManage}
          canTrack={canTrack}
        />
      )}
    </div>
  );
}
