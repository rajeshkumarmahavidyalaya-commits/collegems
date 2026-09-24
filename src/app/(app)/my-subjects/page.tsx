import { BookOpen, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { choiceRule } from "@/lib/validations/electives";
import { getMySubjects } from "./actions";
import { ChoiceForm } from "./choice-form";

export const metadata = { title: "My subjects" };

/**
 * A student's subjects this year. Only the groups allotted to their own class
 * reach this page -- `subject_choices_for_student` finds the class from the
 * enrolment, not from anything the browser sends -- and only the subjects
 * allotted to each group can be ticked, because those are the only ones drawn
 * and the only ones `subject_choice_save` accepts.
 */
export default async function MySubjectsPage() {
  const [mine, locale] = await Promise.all([getMySubjects(), getLocale()]);

  if (!mine.enrolled) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <h1 className="text-2xl font-semibold">My subjects</h1>
        <Alert>
          <BookOpen className="size-4" aria-hidden="true" />
          <AlertTitle>Not enrolled in a class this year</AlertTitle>
          <AlertDescription>
            Your subjects appear once the office has placed you in a class for this year. If you think
            that has happened, ask them to check your login is linked to your student record.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My subjects</h1>
        <p className="text-sm text-muted-foreground">
          {mine.classLabel}. Everybody in your class studies the subjects below; where there is a choice,
          pick from the subjects offered to your class.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Studied by everybody in {mine.classLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {mine.compulsory.length === 0 ? (
            <p className="text-sm text-muted-foreground">The office has not listed the class subjects yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {mine.compulsory.map((s) => (
                <li key={s.id}>
                  <Badge variant="secondary">{s.name}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {mine.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There is nothing to choose for your class this year.
        </p>
      ) : (
        mine.groups.map((g) => {
          const chosen = g.options.filter((o) => o.chosen);
          return (
            <Card key={g.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {g.name}
                  {g.isOpen ? (
                    <Badge>Open</Badge>
                  ) : (
                    <Badge variant="outline">
                      <Lock className="size-3" aria-hidden="true" />
                      Closed
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {choiceRule(g.min, g.max)}
                  {g.isOpen && g.closesOn ? ` by ${formatDate(g.closesOn, locale)}` : ""}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {g.isOpen ? (
                  <ChoiceForm group={g} />
                ) : chosen.length ? (
                  <p className="text-sm">
                    You chose: <span className="font-medium">{chosen.map((c) => c.name).join(", ")}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Not open for choosing. The office opens it when choices are due.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
