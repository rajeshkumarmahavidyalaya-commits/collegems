"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes-guard";
import { formatCell, parseCell, type TestMarkInput } from "@/lib/validations/class-tests";
import { saveTestMarks, type SheetRow } from "../actions";

/**
 * One test's marks, one input per child. Type a number or AB; Enter moves
 * down the column, as on the exam marks grid, because a teacher reads the
 * papers in roll order and types without looking up.
 */
export function TestSheet({ testId, maxMarks, rows }: { testId: string; maxMarks: number; rows: SheetRow[] }) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.studentId, formatCell(r)])),
    [rows],
  );
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const invalid = rows.filter((r) => {
    const v = parseCell(draft[r.studentId] ?? "");
    return v === "invalid" || (!v.absent && v.marks !== null && v.marks > maxMarks);
  });
  const changed = rows.filter((r) => (draft[r.studentId] ?? "") !== (initial[r.studentId] ?? "")).length;
  useUnsavedChangesGuard(changed > 0);

  function save() {
    setError(null);
    setStatus(null);
    const before: TestMarkInput[] = rows.map((r) => ({ studentId: r.studentId, marks: r.marks, absent: r.absent }));
    const after: TestMarkInput[] = [];
    for (const r of rows) {
      const v = parseCell(draft[r.studentId] ?? "");
      if (v === "invalid") {
        setError(`${r.studentName}: type a number or AB.`);
        return;
      }
      after.push({ studentId: r.studentId, ...v });
    }
    startTransition(async () => {
      const result = await saveTestMarks(testId, before, after);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus(
        `${result.data.saved} mark${result.data.saved === 1 ? "" : "s"} saved` +
          (result.data.cleared > 0 ? `, ${result.data.cleared} cleared` : ""),
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="min-h-5 text-sm">
          {error ? (
            <span role="alert" className="font-medium text-destructive">
              {error}
            </span>
          ) : (
            <span className="text-muted-foreground">{status ?? `Out of ${maxMarks}. Type AB for absent.`}</span>
          )}
        </p>
        <Button onClick={save} disabled={saving || changed === 0 || invalid.length > 0}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          {changed === 0 ? "Nothing changed" : `Save ${changed} mark${changed === 1 ? "" : "s"}`}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="w-16 p-2 text-start font-medium">Roll</th>
              <th scope="col" className="p-2 text-start font-medium">Student</th>
              <th scope="col" className="w-32 p-2 text-start font-medium">Marks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const raw = draft[r.studentId] ?? "";
              const v = parseCell(raw);
              const bad = v === "invalid" || (!v.absent && v.marks !== null && v.marks > maxMarks);
              return (
                <tr key={r.studentId} className="border-t border-border">
                  <td className="p-2 font-mono text-muted-foreground">{r.rollNumber ?? "—"}</td>
                  <td className="p-2">{r.studentName}</td>
                  <td className="p-1.5">
                    <Input
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      value={raw}
                      inputMode="decimal"
                      aria-label={`Marks for ${r.studentName}`}
                      aria-invalid={bad || undefined}
                      className={`h-8 w-24 font-mono ${bad ? "border-destructive" : ""}`}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [r.studentId]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "ArrowDown") {
                          e.preventDefault();
                          inputs.current[i + 1]?.focus();
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          inputs.current[i - 1]?.focus();
                        }
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
