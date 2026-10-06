"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rateTeacher, type MyTeacherRow } from "../rating-actions";

/**
 * A student's own teachers this year, one card per subject: a 1-5 rating and
 * an optional sentence. `staff_rate` decides whom a rating is about from the
 * subject, so nothing here can point a rating at somebody else.
 */
export function RateTeachers({ rows }: { rows: MyTeacherRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-10 text-center">
        <p className="font-medium">No teachers to rate yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When your class&apos;s subjects have teachers this year, they appear here.
        </p>
      </div>
    );
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {rows.map((r) => (
        <RateCard key={r.sectionSubjectId} row={r} />
      ))}
    </ul>
  );
}

function RateCard({ row }: { row: MyTeacherRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rating, setRating] = useState<number>(row.rating ?? 0);
  const [feedback, setFeedback] = useState(row.feedback ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `rate-${row.sectionSubjectId}`;

  function save() {
    setError(null);
    if (rating < 1) return setError("Choose a rating from 1 to 5.");
    start(async () => {
      const r = await rateTeacher(row.sectionSubjectId, rating, feedback);
      if (!r.ok) return setError(r.error);
      toast.success(`Your rating for ${row.subjectName} is saved.`);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div>
        <p className="font-semibold">{row.subjectName}</p>
        <p className="text-sm text-muted-foreground">{row.teacherName ?? "Teacher"}</p>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Rating</legend>
        <div className="flex gap-1" role="radiogroup" aria-label={`Rating for ${row.subjectName}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} of 5`}
              onClick={() => setRating(n)}
              className="rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={n <= rating ? "size-6 fill-[color:var(--brand-accent)] text-[color:var(--brand-accent)]" : "size-6 text-muted-foreground"}
                aria-hidden="true"
              />
            </button>
          ))}
          <span className="ms-2 self-center text-sm tabular-nums text-muted-foreground">{rating > 0 ? `${rating} of 5` : "Not rated"}</span>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Feedback (optional)</Label>
        <Textarea id={id} rows={2} maxLength={1000} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Only the college&apos;s administrator reads ratings. Your teacher does not.
        </span>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {row.rating ? "Update" : "Save"}
        </Button>
      </div>
    </li>
  );
}
