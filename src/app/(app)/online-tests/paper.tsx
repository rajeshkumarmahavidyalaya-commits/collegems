"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  GRACE_MS,
  SAVE_EVERY_MS,
  formatRemaining,
  scoreText,
} from "@/lib/validations/online-tests-display";
import {
  reviewTest,
  saveAnswers,
  startTest,
  submitTest,
  type Paper,
  type ReviewedQuestion,
} from "./actions";

/**
 * The student's paper. Nothing is fetched until they press Begin, because
 * reading the questions *is* starting the clock (`online_test_start`) -- a page
 * that loaded the paper on render would start it on a prefetch.
 *
 * Answers live in this component and reach the database at most every
 * `SAVE_EVERY_MS`, when the page is hidden, and on submit. Every save is an
 * audited UPDATE (rule 9), so a keystroke-by-keystroke save would be an audit
 * row per click; a crash loses at most thirty seconds instead.
 */
export function SitTest({
  testId,
  started,
  submitted,
  canReview,
  opensLabel,
  isOpen,
}: {
  testId: string;
  started: boolean;
  submitted: boolean;
  canReview: boolean;
  opensLabel: string;
  isOpen: boolean;
}) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [review, setReview] = useState<{ score: number | null; maxScore: number | null; questions: ReviewedQuestion[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    startTransition(async () => {
      const result = await startTest(testId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPaper(result.data);
    });
  }

  function showReview() {
    startTransition(async () => {
      const result = await reviewTest(testId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReview(result.data);
    });
  }

  if (review) return <Review review={review} />;
  if (paper) return <Sitting testId={testId} paper={paper} />;

  if (submitted) {
    return canReview ? (
      <Button type="button" onClick={showReview} disabled={pending} className="self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        See the answers
      </Button>
    ) : null;
  }

  if (!isOpen && !started) {
    return <p className="text-sm text-muted-foreground">{opensLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm">
        {started
          ? "You have started this test. Continue where you left off — the clock kept running."
          : "The clock starts the moment you begin, and does not stop if you close the page."}
      </p>
      <Button type="button" onClick={begin} disabled={pending} className="self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
        {started ? "Continue" : "Begin now"}
      </Button>
    </div>
  );
}

function Sitting({ testId, paper }: { testId: string; paper: Paper }) {
  const [answers, setAnswers] = useState<Record<string, number>>(paper.answers);
  const [result, setResult] = useState<{ score: number | null; maxScore: number | null; late: boolean } | null>(
    paper.attempt.submittedAt
      ? { score: paper.attempt.score, maxScore: paper.attempt.maxScore, late: paper.attempt.submittedLate }
      : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [savedAt, setSavedAt] = useState<string | null>(paper.attempt.savedAt);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);
  const latest = useRef(answers);
  latest.current = answers;
  const dueAt = Date.parse(paper.attempt.dueAt);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const r = await saveAnswers(testId, latest.current);
    if (r.ok) setSavedAt(r.data.savedAt);
    else {
      dirty.current = true;
      toast.error(r.error);
    }
  }, [testId]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const r = await submitTest(testId, latest.current);
    setSubmitting(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    dirty.current = false;
    setResult({ score: r.data.score, maxScore: r.data.maxScore, late: r.data.submittedLate });
  }, [testId, submitting]);

  // The clock, once a second. At zero the paper hands itself in.
  useEffect(() => {
    if (result) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [result]);

  const handedIn = useRef(false);
  useEffect(() => {
    if (!result && !handedIn.current && now >= dueAt) {
      handedIn.current = true;
      void submit();
    }
  }, [now, dueAt, result, submit]);

  useEffect(() => {
    if (result) return;
    const id = setInterval(() => void save(), SAVE_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") void save();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [result, save]);

  if (result) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
          Submitted. Your mark: {scoreText(result.score, result.maxScore)}.
        </p>
        {result.late ? (
          <p className="text-sm text-muted-foreground">
            This arrived after time was up, so it was marked on the answers saved before then.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {paper.test.revealAnswers
            ? "The answers are shown here once the test has closed for the whole class."
            : "Your teacher has chosen not to show the answers for this test."}
        </p>
        <Link href="/online-tests" className="text-sm underline underline-offset-2">
          Back to online tests
        </Link>
      </div>
    );
  }

  const remaining = dueAt - now;
  const unanswered = paper.questions.filter((q) => answers[q.id] === undefined).length;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const note = unanswered > 0 ? ` ${unanswered} ${unanswered === 1 ? "question is" : "questions are"} unanswered.` : "";
        if (!window.confirm(`Hand in your answers now?${note} You cannot change them afterwards.`)) return;
        void submit();
      }}
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/95 p-3 backdrop-blur">
        <p className="flex items-center gap-2 font-mono text-lg" aria-live="off">
          <Clock className="size-5" aria-hidden="true" />
          <span>{formatRemaining(remaining)}</span>
          <span className="sr-only">left</span>
        </p>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {remaining <= 0 && remaining > -GRACE_MS
            ? "Time is up — handing in…"
            : savedAt
              ? "Saved"
              : "Not saved yet"}
        </p>
      </div>
      {paper.test.instructions ? (
        <p className="text-sm whitespace-pre-line text-muted-foreground">{paper.test.instructions}</p>
      ) : null}
      <ol className="flex flex-col gap-4">
        {paper.questions.map((q, i) => (
          <li key={q.id}>
            <fieldset className="rounded-lg border border-border bg-card p-4">
              <legend className="sr-only">Question {i + 1}</legend>
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium break-words whitespace-pre-line">
                  {i + 1}. {q.prompt}
                </p>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {q.marks} {q.marks === 1 ? "mark" : "marks"}
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {q.options.map((o, idx) => (
                  <label
                    key={idx}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name={q.id}
                      checked={answers[q.id] === idx}
                      onChange={() => {
                        dirty.current = true;
                        setAnswers({ ...answers, [q.id]: idx });
                      }}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span className="break-words">{o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <Button type="submit" disabled={submitting} className="self-start">
        {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Hand in
      </Button>
    </form>
  );
}

function Review({ review }: { review: { score: number | null; maxScore: number | null; questions: ReviewedQuestion[] } }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-medium">Your mark: {scoreText(review.score, review.maxScore)}</p>
      <ol className="flex flex-col gap-3">
        {review.questions.map((q, i) => {
          const right = q.chosen === q.correctOption;
          return (
            <li key={q.id} className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-start gap-2 font-medium break-words">
                {right ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span>
                  {i + 1}. {q.prompt}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({right ? "right" : q.chosen == null ? "not answered" : "wrong"})
                  </span>
                </span>
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {q.options.map((o, idx) => (
                  <li key={idx}>
                    {o}
                    {idx === q.correctOption ? <strong> — the right answer</strong> : null}
                    {idx === q.chosen && idx !== q.correctOption ? <span> — your answer</span> : null}
                    {idx === q.chosen && idx === q.correctOption ? <span> (yours)</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
