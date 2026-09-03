"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Save, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { saveRemark, type RemarkRow } from "../../report-card-actions";

const LIMIT = 500;

/**
 * A class of remarks on one screen. The write is one call per changed row --
 * `exams_set_remark` is per student -- but only changed rows are sent, so
 * reopening the sheet to fix one sentence is one write, not forty.
 */
export function RemarkSheet({
  examId,
  sections,
  sectionId,
  rows,
  frozen,
  canRemark,
}: {
  examId: string;
  sections: { id: string; label: string }[];
  sectionId: string | null;
  rows: RemarkRow[];
  frozen: boolean;
  canRemark: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of rows) map[row.studentId] = row.remark ?? "";
    return map;
  }, [rows]);

  const [draft, setDraft] = useState<Record<string, string>>(initial);

  const changed = useMemo(
    () => rows.filter((row) => (draft[row.studentId] ?? "") !== (initial[row.studentId] ?? "")),
    [rows, draft, initial],
  );

  const disabled = frozen || !canRemark;
  useUnsavedChangesGuard(changed.length > 0 && !disabled);

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);

    let written = 0;
    let cleared = 0;
    for (const row of changed) {
      const result = await saveRemark(examId, {
        studentId: row.studentId,
        remark: draft[row.studentId] ?? "",
      });
      if (!result.ok) {
        setError(result.error);
        setSaving(false);
        return;
      }
      if (result.data.cleared) cleared += 1;
      else written += 1;
    }

    setSaving(false);
    setStatus(
      `${written} remark${written === 1 ? "" : "s"} saved` +
        (cleared > 0 ? `, ${cleared} cleared` : ""),
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="remark-section">Class</Label>
          <Select
            value={sectionId ?? undefined}
            onValueChange={(next) => {
              startTransition(() => {
                router.push(`/exams/${examId}/remarks?section=${next}`);
              });
            }}
          >
            <SelectTrigger id="remark-section" className="w-[16rem] cursor-pointer">
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

        {sectionId && !disabled ? (
          <Button
            type="button"
            onClick={save}
            disabled={saving || changed.length === 0}
            className="cursor-pointer"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {changed.length === 0
              ? "Nothing changed"
              : `Save ${changed.length} remark${changed.length === 1 ? "" : "s"}`}
          </Button>
        ) : null}
      </div>

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
        <EmptyState
          title="Choose a class"
          body="A remark belongs to a child their class teacher knows, so the sheet is one class at a time."
        />
      ) : pending ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nobody in this class"
          body="This class has no active enrolments in the session this exam belongs to."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const value = draft[row.studentId] ?? "";
            const over = value.length > LIMIT;
            return (
              <li
                key={row.studentId}
                className="rounded-lg border border-border bg-card p-4 transition-colors duration-200"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Label htmlFor={`remark-${row.studentId}`} className="font-medium">
                    <span className="font-mono text-muted-foreground">{row.rollNumber ?? "—"}</span>{" "}
                    {row.studentName}
                  </Label>
                  <span
                    className={`text-xs ${over ? "font-medium text-destructive" : "text-muted-foreground"}`}
                  >
                    {value.length} / {LIMIT}
                  </span>
                </div>
                <Textarea
                  id={`remark-${row.studentId}`}
                  className="mt-2"
                  rows={2}
                  value={value}
                  disabled={disabled}
                  aria-invalid={over || undefined}
                  aria-describedby={over ? `remark-${row.studentId}-error` : undefined}
                  placeholder={
                    disabled ? "Frozen" : "One sentence this child's parent would recognise"
                  }
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, [row.studentId]: event.target.value }))
                  }
                />
                {over ? (
                  <p
                    id={`remark-${row.studentId}-error`}
                    role="alert"
                    className="mt-1 text-xs font-medium text-destructive"
                  >
                    A remark is one line on a card. Keep it under {LIMIT} characters.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center">
      <Users className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
