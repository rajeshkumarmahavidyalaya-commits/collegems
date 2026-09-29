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
  cellKey,
  planBehaviourSave,
  scaleLegend,
  type BehaviourGrade,
  type BehaviourScale,
  type GradeMap,
} from "@/lib/validations/behaviour";
import { useI18n } from "@/components/providers/i18n-provider";
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
  scale,
  frozen,
  canGrade,
}: {
  examId: string;
  sections: { id: string; label: string }[];
  sectionId: string | null;
  traits: BehaviourTrait[];
  students: BehaviourStudent[];
  grades: GradeMap;
  scale: BehaviourScale;
  frozen: boolean;
  canGrade: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
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

  // The grade a class that behaved usually gets: the second letter of the
  // college's own scale (B on every scale this product allows).
  const usual = scale.grades[1] ?? scale.grades[0];

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
      t.plural("behaviour.saved", saved) + (cleared > 0 ? `, ${t("behaviour.cleared", { count: cleared })}` : ""),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="behaviour-section">{t("behaviour.class")}</Label>
          <Select
            value={sectionId ?? undefined}
            onValueChange={(next) =>
              startTransition(() => router.push(`/exams/${examId}/behaviour?section=${next}`))
            }
          >
            <SelectTrigger id="behaviour-section" className="w-[16rem] cursor-pointer">
              <SelectValue placeholder={t("behaviour.chooseClass")} />
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
            {changes === 0 ? t("behaviour.nothingChanged") : t.plural("behaviour.save", changes)}
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {scaleLegend(scale)}
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
        <Empty title={t("behaviour.chooseClass")} body={t("behaviour.emptyClassBody")} />
      ) : pending ? (
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
      ) : traits.length === 0 ? (
        <Empty title={t("behaviour.noTraitsTitle")} body={t("behaviour.noTraitsBody")} />
      ) : students.length === 0 ? (
        <Empty title={t("behaviour.nobodyTitle")} body={t("behaviour.nobodyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="sticky start-0 bg-muted/50 p-2 text-start font-medium">
                  {t("behaviour.student")}
                </th>
                {traits.map((trait) => (
                  <th key={trait.id} scope="col" className="min-w-28 p-2 text-start align-bottom font-medium">
                    <span className="block text-xs text-muted-foreground">
                      {trait.kind === "skill" ? t("behaviour.kind.skill") : t("behaviour.kind.behaviour")}
                    </span>
                    {trait.name}
                    {!disabled && (
                      <button
                        type="button"
                        className="mt-1 block text-xs font-normal text-primary underline-offset-2 hover:underline"
                        onClick={() => fillColumn(trait.id, usual)}
                        aria-label={t("behaviour.fillBlanksLabel", { grade: usual, trait: trait.name })}
                      >
                        {t("behaviour.fillBlanks", { grade: usual })}
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
                  {traits.map((trait) => {
                    const value: string = draft[cellKey(s.studentId, trait.id)] ?? "-";
                    return (
                      <td key={trait.id} className="p-1.5">
                        <Select
                          value={value}
                          disabled={disabled}
                          onValueChange={(v) => setCell(s.studentId, trait.id, v)}
                        >
                          <SelectTrigger
                            className="h-8 w-20 cursor-pointer"
                            aria-label={t("behaviour.cellLabel", { trait: trait.name, name: s.studentName })}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-">—</SelectItem>
                            {scale.grades.map((g) => (
                              <SelectItem key={g} value={g}>
                                {g} · {scale.meaning[g]}
                              </SelectItem>
                            ))}
                            {/* A grade given before the scale shrank stays
                                visible rather than blank (0307). */}
                            {value !== "-" && !scale.grades.includes(value as BehaviourGrade) && (
                              <SelectItem value={value}>{value}</SelectItem>
                            )}
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
