"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import {
  BEHAVIOUR_GRADES,
  GRADE_MEANING,
  cellKey,
  planBehaviourSave,
  type BehaviourGrade,
  type GradeMap,
} from "@/lib/validations/behaviour";
import { saveBehaviour, type BehaviourStudent, type BehaviourTrait } from "../../behaviour-actions";

/**
 * One class, every trait, one grade a cell (0303). A grid rather than a form
 * per child, because the job is "grade Discipline for all forty", and a
 * teacher moves down a column. Only changed cells are written.
 */
export function BehaviourGrid({
  examId,
  sections,
  sectionId,
  traits,
  students,
  grades,
  frozen,
  canGrade,
}: {
  examId: string;
  sections: { id: string; label: string }[];
  sectionId: string | null;
  traits: BehaviourTrait[];
  students: BehaviourStudent[];
  grades: GradeMap;
  frozen: boolean;
  canGrade: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GradeMap>(grades);

  const plan = useMemo(() => planBehaviourSave(grades, draft), [grades, draft]);
  const changes = plan.upserts.length + plan.deletes.length;
  const disabled = frozen || !canGrade;
  useUnsavedChangesGuard(changes > 0 && !disabled);

  function setCell(studentId: string, traitId: string, value: string) {
    setDraft((prev) => {
      const next = { ...prev };
      const key = cellKey(studentId, traitId);
      if (value === "-") delete next[key];
      else next[key] = value as BehaviourGrade;
      return next;
    });
  }

  /** Fill a whole column with one grade -- the common case for a class that behaved. */
  function fillColumn(traitId: string, grade: BehaviourGrade) {
    setDraft((prev) => {
      const next = { ...prev };
      for (const s of students) {
        const key = cellKey(s.studentId, traitId);
        if (!next[key]) next[key] = grade;
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    const result = await saveBehaviour(examId, plan);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { saved, cleared } = result.data;
    setStatus(
      `${saved} grade${saved === 1 ? "" : "s"} saved` + (cleared > 0 ? `, ${cleared} cleared` : ""),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="behaviour-section">Class</Label>
          <Select
            value={sectionId ?? undefined}
            onValueChange={(next) =>
              startTransition(() => router.push(`/exams/${examId}/behaviour?section=${next}`))
            }
          >
            <SelectTrigger id="behaviour-section" className="w-[16rem] cursor-pointer">
              <SelectValue placeholder="Choose a class" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id} className="cursor-pointer">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {sectionId && !disabled && students.length > 0 ? (
          <Button type="button" onClick={save} disabled={saving || changes === 0}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {changes === 0 ? "Nothing changed" : `Save ${changes} change${changes === 1 ? "" : "s"}`}
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {BEHAVIOUR_GRADES.map((g) => `${g} ${GRADE_MEANING[g]}`).join(" · ")}
      </p>

      <p aria-live="polite" className="min-h-5 text-sm">
        {error ? (
          <span role="alert" className="font-medium text-destructive">
            {error}
          </span>
        ) : (
          <span className="text-muted-foreground">{status ?? ""}</span>
        )}
      </p>

      {!sectionId ? (
        <Empty title="Choose a class" body="Grades are given a class at a time, by the teacher who knows the children." />
      ) : pending ? (
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
      ) : traits.length === 0 ? (
        <Empty title="No traits to grade" body="Add what the college grades -- discipline, sport, art -- in the list below." />
      ) : students.length === 0 ? (
        <Empty title="Nobody in this class" body="This class has no active enrolments in the year this exam belongs to." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="sticky start-0 bg-muted/50 p-2 text-start font-medium">
                  Student
                </th>
                {traits.map((t) => (
                  <th key={t.id} scope="col" className="min-w-28 p-2 text-start align-bottom font-medium">
                    <span className="block text-xs text-muted-foreground">
                      {t.kind === "skill" ? "Skill" : "Behaviour"}
                    </span>
                    {t.name}
                    {!disabled && (
                      <button
                        type="button"
                        className="mt-1 block text-xs font-normal text-primary underline-offset-2 hover:underline"
                        onClick={() => fillColumn(t.id, "B")}
                        aria-label={`Give B for ${t.name} to everybody not yet graded`}
                      >
                        Fill blanks with B
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.studentId} className="border-t border-border">
                  <th scope="row" className="sticky start-0 bg-card p-2 text-start font-normal">
                    <span className="font-mono text-muted-foreground">{s.rollNumber ?? "—"}</span>{" "}
                    {s.studentName}
                  </th>
                  {traits.map((t) => {
                    const value = draft[cellKey(s.studentId, t.id)] ?? "-";
                    return (
                      <td key={t.id} className="p-1.5">
                        <Select
                          value={value}
                          disabled={disabled}
                          onValueChange={(v) => setCell(s.studentId, t.id, v)}
                        >
                          <SelectTrigger
                            className="h-8 w-20 cursor-pointer"
                            aria-label={`${t.name} for ${s.studentName}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-">—</SelectItem>
                            {BEHAVIOUR_GRADES.map((g) => (
                              <SelectItem key={g} value={g}>
                                {g} · {GRADE_MEANING[g]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
