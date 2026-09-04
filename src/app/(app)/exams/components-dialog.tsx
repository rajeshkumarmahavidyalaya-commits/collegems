"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, SplitSquareHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { componentTotal, componentTotalProblem } from "@/lib/validations/exams";
import { savePaperComponents, type PaperRow } from "./actions";

type Draft = { code: string; name: string; maxMarks: string; passMarks: string };

const SUGGESTIONS: Draft[][] = [
  [
    { code: "TH", name: "Theory", maxMarks: "", passMarks: "" },
    { code: "PR", name: "Practical", maxMarks: "", passMarks: "" },
  ],
  [
    { code: "TH", name: "Theory", maxMarks: "", passMarks: "" },
    { code: "IA", name: "Internal assessment", maxMarks: "", passMarks: "" },
  ],
];

/**
 * How a paper is split, as rows a person edits — the same shape as the paper
 * dialog beside it, and deliberately not a free-text "70+30" field.
 *
 * The running total under the table is the browser's half of "the parts add up
 * to the paper". Postgres is the half that decides; this only means nobody
 * presses Save to find out they are ten marks short.
 */
export function ComponentsDialog({
  paper,
  open,
  onOpenChange,
  isPublished,
}: {
  paper: PaperRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPublished: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (!paper) return;
    setDrafts(
      paper.components.map((c) => ({
        code: c.code,
        name: c.name,
        maxMarks: String(c.maxMarks),
        passMarks: String(c.passMarks),
      })),
    );
  }, [paper]);

  const parsed = useMemo(
    () =>
      drafts.map((d) => ({
        code: d.code.trim(),
        name: d.name.trim(),
        maxMarks: d.maxMarks.trim() === "" ? Number.NaN : Number(d.maxMarks),
        passMarks: d.passMarks.trim() === "" ? 0 : Number(d.passMarks),
      })),
    [drafts],
  );

  const total = componentTotal(parsed);
  const totalProblem = paper ? componentTotalProblem(parsed, paper.maxMarks) : null;
  const singlePart = drafts.length === 1;
  const duplicateCode =
    new Set(parsed.map((p) => p.code.toLowerCase())).size !== parsed.length && parsed.length > 0;
  const blocked = Boolean(totalProblem) || singlePart || duplicateCode || isPublished;

  function update(index: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function submit() {
    if (!paper) return;
    startTransition(async () => {
      const result = await savePaperComponents({
        examSubjectId: paper.id,
        components: parsed.map((p) => ({
          code: p.code,
          name: p.name,
          maxMarks: p.maxMarks,
          passMarks: p.passMarks,
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.parts === 0
          ? "This paper is marked as one again."
          : `Split into ${result.data.parts} parts.`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {paper ? `${paper.sectionLabel} · ${paper.subjectName}` : "Split this paper"}
          </DialogTitle>
          <DialogDescription>
            A paper marked in more than one sitting — theory and practical, written and oral — is
            entered part by part. The parts must add up to the paper&rsquo;s{" "}
            {paper?.maxMarks ?? 0} marks, and a part&rsquo;s own minimum only fails a child if this
            exam&rsquo;s grading scheme says every part must be passed.
          </DialogDescription>
        </DialogHeader>

        {isPublished && (
          <Alert>
            <AlertTitle>This exam is published</AlertTitle>
            <AlertDescription>
              How a paper is split cannot change while results are frozen. Unpublish the exam first.
            </AlertDescription>
          </Alert>
        )}

        {drafts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-10 text-center">
            <span className="rounded-full bg-muted p-3">
              <SplitSquareHorizontal className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">This paper is marked as one</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                One mark out of {paper?.maxMarks ?? 0}. Split it if the class sits it in more than
                one part.
              </p>
            </div>
            {!isPublished && (
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion.map((s) => s.code).join("-")}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDrafts(
                        suggestion.map((s, i) => ({
                          ...s,
                          maxMarks:
                            i === 0
                              ? String(Math.round((paper?.maxMarks ?? 100) * 0.7))
                              : String(
                                  (paper?.maxMarks ?? 100) -
                                    Math.round((paper?.maxMarks ?? 100) * 0.7),
                                ),
                          passMarks: "0",
                        })),
                      )
                    }
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {suggestion.map((s) => s.name).join(" + ")}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Code
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Name
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Out of
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Minimum
                    </th>
                    <th scope="col" className="w-10 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft, index) => (
                    <tr key={index} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">
                        <Label htmlFor={`part-code-${index}`} className="sr-only">
                          Code for part {index + 1}
                        </Label>
                        <Input
                          id={`part-code-${index}`}
                          value={draft.code}
                          maxLength={8}
                          disabled={isPublished}
                          onChange={(e) => update(index, { code: e.target.value })}
                          className="h-8 w-20 font-mono uppercase"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <Label htmlFor={`part-name-${index}`} className="sr-only">
                          Name for part {index + 1}
                        </Label>
                        <Input
                          id={`part-name-${index}`}
                          value={draft.name}
                          disabled={isPublished}
                          onChange={(e) => update(index, { name: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <Label htmlFor={`part-max-${index}`} className="sr-only">
                          Maximum for part {index + 1}
                        </Label>
                        <Input
                          id={`part-max-${index}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={draft.maxMarks}
                          disabled={isPublished}
                          onChange={(e) => update(index, { maxMarks: e.target.value })}
                          className="h-8 w-24 font-mono tabular-nums"
                        />
                      </td>
                      <td className="py-1.5 pr-3">
                        <Label htmlFor={`part-pass-${index}`} className="sr-only">
                          Minimum for part {index + 1}
                        </Label>
                        <Input
                          id={`part-pass-${index}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={draft.passMarks}
                          disabled={isPublished}
                          onChange={(e) => update(index, { passMarks: e.target.value })}
                          className="h-8 w-24 font-mono tabular-nums"
                        />
                      </td>
                      <td className="py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isPublished}
                          onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== index))}
                          aria-label={`Remove ${draft.name || `part ${index + 1}`}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!isPublished && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDrafts((prev) => [
                      ...prev,
                      { code: "", name: "", maxMarks: "", passMarks: "0" },
                    ])
                  }
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add a part
                </Button>
              )}
              <p
                className={cn(
                  "ml-auto font-mono text-sm tabular-nums",
                  totalProblem ? "text-destructive" : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {total} of {paper?.maxMarks ?? 0}
              </p>
            </div>

            {(totalProblem || singlePart || duplicateCode) && (
              <Alert variant="destructive">
                <AlertTitle>This split cannot be saved yet</AlertTitle>
                <AlertDescription>
                  <ul className="list-inside list-disc">
                    {totalProblem && <li>{totalProblem}</li>}
                    {singlePart && (
                      <li>A paper split into one part is a paper. Add another, or remove it.</li>
                    )}
                    {duplicateCode && <li>Two parts share a code. Each needs its own.</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || blocked}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {drafts.length === 0 ? "Mark as one paper" : "Save the split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
