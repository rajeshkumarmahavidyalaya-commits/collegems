import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { choiceRule, type MySubjects } from "@/lib/validations/electives";
import { ChoiceForm } from "./choice-form";

type Save = (groupId: string, subjectIds: string[]) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * A child's subjects this year: what the whole class studies, and each elective
 * choice allotted to their class. Who may change a choice is the caller's
 * decision, passed in as `mode` and `save`:
 *
 * - `self`: the student, only while a choice is open (the window is checked
 *   again by `subject_choice_save`, which is the gate);
 * - `office`: somebody choosing on the child's behalf, open or not;
 * - `readonly`: a parent, or anybody else who may only look.
 *
 * A Server Component; only the tick boxes are client code.
 */
export function SubjectsView({
  mine,
  locale,
  mode,
  save,
}: {
  mine: Extract<MySubjects, { enrolled: true }>;
  locale: Locale;
  mode: "self" | "office" | "readonly";
  save?: Save;
}) {
  return (
    <div className="flex flex-col gap-4">
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
        <p className="text-sm text-muted-foreground">There is nothing to choose for this class this year.</p>
      ) : (
        mine.groups.map((g) => {
          const chosen = g.options.filter((o) => o.chosen);
          const editable = save && (mode === "office" || (mode === "self" && g.isOpen));
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
                  {mode === "office" && !g.isOpen ? " Closed to students; the office can still change it." : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {editable ? (
                  <ChoiceForm group={g} save={save} />
                ) : chosen.length ? (
                  <p className="text-sm">
                    Chosen: <span className="font-medium">{chosen.map((c) => c.name).join(", ")}</span>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {g.isOpen ? "Nothing chosen yet." : "Not open for choosing. The office opens it when choices are due."}
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
