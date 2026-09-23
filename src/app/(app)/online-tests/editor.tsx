"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Send, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OPTIONS_MAX, OPTIONS_MIN } from "@/lib/validations/online-tests-display";
import {
  deleteQuestion,
  deleteTest,
  publishTest,
  saveQuestion,
  unpublishTest,
  type Question,
} from "./actions";

/*
 * The teacher's half of a test's page. No Zod here: the server action
 * validates, and a page that edits questions has no reason to ship a schema
 * library to do it (rule 15's split).
 */

/**
 * The questions with their key, as the teacher sees them. Editable while the
 * test is a draft; read-only once published -- the database refuses the edit
 * then anyway (rule 4's device), so the form is simply not drawn.
 */
export function QuestionList({
  testId,
  questions,
  editable,
}: {
  testId: string;
  questions: Question[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {questions.length === 0 && editing !== "new" ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No questions yet. Add the first one below.
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {questions.map((q, i) =>
          editing === q.id ? (
            <li key={q.id}>
              <QuestionForm testId={testId} initial={q} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={q.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium break-words">
                  {i + 1}. {q.prompt}
                </p>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {q.marks} {q.marks === 1 ? "mark" : "marks"}
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {q.options.map((o, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    {idx === q.correctOption ? (
                      <Check className="size-4 text-primary" aria-hidden="true" />
                    ) : (
                      <span className="size-4" aria-hidden="true" />
                    )}
                    <span className={idx === q.correctOption ? "font-medium" : undefined}>{o}</span>
                    {idx === q.correctOption ? <span className="sr-only">(the right answer)</span> : null}
                  </li>
                ))}
              </ul>
              {editable ? (
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(q.id)}>
                    <Pencil aria-hidden="true" />
                    Edit
                  </Button>
                  <DeleteQuestion testId={testId} questionId={q.id} />
                </div>
              ) : null}
            </li>
          ),
        )}
      </ol>
      {editable ? (
        editing === "new" ? (
          <QuestionForm testId={testId} onDone={() => setEditing(null)} />
        ) : (
          <Button type="button" variant="outline" className="self-start" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            Add a question
          </Button>
        )
      ) : null}
    </div>
  );
}

function DeleteQuestion({ testId, questionId }: { testId: string; questionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Remove this question?")) return;
        startTransition(async () => {
          const result = await deleteQuestion(testId, questionId);
          if (!result.ok) toast.error(result.error);
          else router.refresh();
        });
      }}
    >
      <Trash2 aria-hidden="true" />
      Remove
    </Button>
  );
}

function QuestionForm({ testId, initial, onDone }: { testId: string; initial?: Question; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [options, setOptions] = useState<string[]>(initial?.options ?? ["", "", "", ""]);
  const [correct, setCorrect] = useState<number>(initial?.correctOption ?? 0);
  const [marks, setMarks] = useState(String(initial?.marks ?? 1));
  const [error, setError] = useState<string | null>(null);
  const id = initial?.id ?? "new";

  function save(event: React.FormEvent) {
    event.preventDefault();
    // Blank options are dropped by the server; the key must point at a kept one,
    // so it is re-indexed over the kept options here.
    const kept = options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o !== "");
    const keyIndex = kept.findIndex((x) => x.i === correct);
    startTransition(async () => {
      const result = await saveQuestion(testId, {
        id: initial?.id,
        prompt,
        options: kept.map((x) => x.o),
        correctOption: keyIndex,
        marks: Number(marks),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-card p-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`prompt-${id}`}>Question</Label>
        <Textarea id={`prompt-${id}`} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} maxLength={2000} required />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Options — choose the right one</legend>
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${id}`}
              checked={correct === i}
              onChange={() => setCorrect(i)}
              aria-label={`Option ${i + 1} is the right answer`}
              className="size-4 shrink-0 accent-primary"
            />
            <Input
              value={o}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={`Option ${i + 1}`}
              maxLength={300}
            />
            {options.length > OPTIONS_MIN ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove option ${i + 1}`}
                onClick={() => {
                  setOptions(options.filter((_, j) => j !== i));
                  if (correct === i) setCorrect(0);
                  else if (correct > i) setCorrect(correct - 1);
                }}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
        {options.length < OPTIONS_MAX ? (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setOptions([...options, ""])}>
            <Plus aria-hidden="true" />
            Another option
          </Button>
        ) : null}
      </fieldset>
      <div className="flex max-w-40 flex-col gap-2">
        <Label htmlFor={`marks-${id}`}>Marks</Label>
        <Input id={`marks-${id}`} type="number" min={0.5} max={100} step={0.5} value={marks} onChange={(e) => setMarks(e.target.value)} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save question
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Publish, take back, delete. A control is drawn only where the database would
 * accept it: taking a test back or deleting it is refused once anybody has
 * started it, so after that neither button is offered.
 */
export function TestControls({
  testId,
  status,
  questionCount,
  sittings,
}: {
  testId: string;
  status: "draft" | "published";
  questionCount: number;
  sittings: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "That did not work.");
        return;
      }
      toast.success(done);
      if (after) after();
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" ? (
        <Button
          type="button"
          disabled={pending || questionCount === 0}
          onClick={() => {
            if (!window.confirm("Publish this test? Its class will see it, and once anybody starts it the questions cannot change.")) return;
            run(() => publishTest(testId), "Published. The class sees it now.");
          }}
        >
          <Send aria-hidden="true" />
          Publish
        </Button>
      ) : sittings === 0 ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => unpublishTest(testId), "Back to draft. The class no longer sees it.")}>
          <Undo2 aria-hidden="true" />
          Back to draft
        </Button>
      ) : null}
      {sittings === 0 ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this test and its questions?")) return;
            run(() => deleteTest(testId), "Test deleted.", () => router.push("/online-tests"));
          }}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      ) : null}
      {status === "draft" && questionCount === 0 ? (
        <p className="basis-full text-sm text-muted-foreground">Add at least one question to publish.</p>
      ) : null}
    </div>
  );
}
