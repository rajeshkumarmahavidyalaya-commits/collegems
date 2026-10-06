import Link from "next/link";
import { BookMarked, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../students/actions";
import { listSubjects } from "../academics/actions";
import { listChapters, listLessons } from "./actions";
import { LessonList } from "./lesson-list";

export const metadata = { title: "Lessons" };

/**
 * The reference's SM Lessons: lessons by subject and chapter, searchable.
 * Chapters are the syllabus's units (0347), so "Chapter's" opens the syllabus
 * rather than a second list of the same thing.
 */
export default async function LessonsPage() {
  const [lessons, canManage, canSeeSyllabus] = await Promise.all([
    listLessons(),
    hasPermission("homework.manage"),
    hasPermission("academics.view"),
  ]);
  const [sections, subjects, chapters] = canManage
    ? await Promise.all([listSections(), listSubjects(), listChapters()])
    : [[], [], []];

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Lessons" icon={BookMarked}>
        {canSeeSyllabus && (
          <Button asChild variant="outline">
            <Link href="/academics/syllabus">
              <ListTree className="size-4" aria-hidden="true" />
              Chapter&apos;s
            </Link>
          </Button>
        )}
      </PageToolbar>
      <LessonList
        lessons={lessons}
        canManage={canManage}
        sections={sections.map((s) => ({ value: s.id, label: s.label }))}
        sectionLevels={Object.fromEntries(sections.map((s) => [s.id, s.classLevelId]))}
        subjects={subjects.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))}
        chapters={chapters}
      />
    </div>
  );
}
