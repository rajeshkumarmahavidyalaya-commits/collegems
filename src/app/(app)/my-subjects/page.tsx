import { BookOpen } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getUserContext } from "@/lib/auth/context";
import { listMyChildren } from "@/lib/auth/family";
import { getLocale } from "@/lib/i18n/server";
import { SubjectsView } from "@/components/electives/subjects-view";
import { getMySubjects, getSubjectsFor, saveMyChoice } from "./actions";

export const metadata = { title: "My subjects" };

function NotEnrolled({ who }: { who: string }) {
  return (
    <Alert>
      <BookOpen className="size-4" aria-hidden="true" />
      <AlertTitle>{who} not enrolled in a class this year</AlertTitle>
      <AlertDescription>
        Subjects appear once the office has placed the student in a class for this year.
      </AlertDescription>
    </Alert>
  );
}

/**
 * A student's subjects, or a parent's children's. What decides which is the
 * record the login stands for (`roles.subject`), for display only: a student
 * chooses through `subject_choice_save`, which takes the student from the
 * login, and a parent only reads -- RLS on enrolments and choices decides whose
 * children those are.
 */
export default async function MySubjectsPage() {
  const [ctx, locale] = await Promise.all([getUserContext(), getLocale()]);

  if (ctx?.roleSubject === "guardian") {
    const children = await listMyChildren();
    const views = await Promise.all(children.map((c) => getSubjectsFor(c.studentId)));
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Subjects</h1>
          <p className="text-sm text-muted-foreground">
            What each of your children studies this year, and the electives they chose.
          </p>
        </div>
        {children.length === 0 && (
          <p className="text-sm text-muted-foreground">No children are linked to your login yet. Ask the office.</p>
        )}
        {children.map((c, i) => {
          const mine = views[i];
          return (
            <section key={c.studentId} className="flex flex-col gap-3" aria-labelledby={`child-${c.studentId}`}>
              <h2 id={`child-${c.studentId}`} className="text-lg font-semibold">
                {c.name}
              </h2>
              {mine.enrolled ? (
                <SubjectsView mine={mine} locale={locale} mode="readonly" />
              ) : (
                <NotEnrolled who={`${c.name} is`} />
              )}
            </section>
          );
        })}
      </div>
    );
  }

  const mine = await getMySubjects();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My subjects</h1>
        <p className="text-sm text-muted-foreground">
          {mine.enrolled
            ? `${mine.classLabel}. Everybody in your class studies the subjects below; where there is a choice, pick from the subjects offered to your class.`
            : "Your subjects for this year."}
        </p>
      </div>
      {mine.enrolled ? (
        <SubjectsView mine={mine} locale={locale} mode="self" save={saveMyChoice} />
      ) : (
        <NotEnrolled who="You are" />
      )}
    </div>
  );
}
