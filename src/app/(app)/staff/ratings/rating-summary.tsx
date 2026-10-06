"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExportRowsButton } from "@/components/export-rows-button";
import { useI18n } from "@/components/providers/i18n-provider";
import { removeRating, type RatingFeedbackRow, type RatingSummaryRow } from "../rating-actions";

/**
 * The reference's Staff Rating: Class, Subject, Teacher, Student Feedback,
 * Average Rating, Action. "View" opens the ratings behind a row, where the
 * administrator may take an abusive one down.
 */
export function RatingSummary({
  rows,
  open,
  feedback,
}: {
  rows: RatingSummaryRow[];
  /** The row whose ratings are shown, as section:subject:staff. */
  open: string | null;
  feedback: RatingFeedbackRow[];
}) {
  const { formatDate } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const opened = rows.find((r) => r.key === open) ?? null;

  function takeDown(f: RatingFeedbackRow) {
    if (!window.confirm(`Take down ${f.studentName}'s rating? It cannot be brought back.`)) return;
    start(async () => {
      const r = await removeRating(f.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Rating taken down.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="ratings-list">
        <div className="flex flex-wrap items-center gap-2 border-b pb-3">
          <h2 id="ratings-list" className="text-lg font-semibold">
            Staff Rating
          </h2>
          <div className="ms-auto">
            <ExportRowsButton
              rows={[
                ["Class", "Section", "Subject", "Teacher", "Ratings", "With feedback", "Average Rating"],
                ...rows.map((r) => [r.className, r.sectionName, r.subjectName, r.teacherName ?? "", String(r.ratings), String(r.withFeedback), r.average.toFixed(2)]),
              ]}
              fileName="staff-ratings.csv"
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-medium">No ratings this year yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Students rate the teacher of each subject they are taught from their own login. A subject needs a teacher
              before it can be rated.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Teacher</TableHead>
                  <TableHead className="text-end">Student Feedback</TableHead>
                  <TableHead>Average Rating</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key} data-state={r.key === open ? "selected" : undefined}>
                    <TableCell>
                      {r.className} · {r.sectionName}
                    </TableCell>
                    <TableCell>{r.subjectName}</TableCell>
                    <TableCell>{r.teacherName ?? "—"}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {r.withFeedback} of {r.ratings}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Star className="size-4 fill-[color:var(--brand-accent)] text-[color:var(--brand-accent)]" aria-hidden="true" />
                        {r.average.toFixed(2)}
                        <span className="text-xs text-muted-foreground">({r.ratings})</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/staff/ratings?for=${r.key}`} scroll={false}>
                          <Eye className="size-4" aria-hidden="true" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {opened && (
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-labelledby="ratings-detail">
          <h2 id="ratings-detail" className="border-b pb-3 text-lg font-semibold">
            {opened.subjectName} · {opened.teacherName ?? "Teacher"} · {opened.className} {opened.sectionName}
          </h2>
          {feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ratings to show.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {feedback.map((f) => (
                <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{f.studentName}</span>{" "}
                      <span className="tabular-nums text-muted-foreground">
                        · {f.rating} of 5 · {formatDate(f.at)}
                      </span>
                    </p>
                    {f.feedback && <p className="mt-0.5 whitespace-pre-line text-sm">{f.feedback}</p>}
                  </div>
                  <Button size="icon" variant="ghost" aria-label={`Take down ${f.studentName}'s rating`} disabled={pending} onClick={() => takeDown(f)}>
                    <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
