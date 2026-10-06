import { Star } from "lucide-react";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { listMyTeachers, listRatingFeedback, listRatingSummary } from "../rating-actions";
import { RateTeachers } from "./rate-teachers";
import { RatingSummary } from "./rating-summary";

export const metadata = { title: "Staff rating" };

/**
 * The reference's Staff Rating (0344). Two screens at one address: a student
 * rates their own teachers; the administrator reads the summary. The record a
 * login stands for decides the first (rule 4: roleSubject, never a list of
 * codes); the policies decide what either may read or write. Everybody else
 * is told who reads ratings, rather than shown an empty table.
 */
export default async function StaffRatingsPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const [ctx, { for: open }] = await Promise.all([getUserContext(), searchParams]);
  const toolbar = <PageToolbar title="Staff Rating" icon={Star} />;

  if (ctx?.roleSubject === "student") {
    const rows = await listMyTeachers();
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <p className="max-w-3xl text-sm text-muted-foreground">
          Rate the teacher of each subject you are taught this year. You can change a rating until the year ends.
        </p>
        <RateTeachers rows={rows} />
      </div>
    );
  }

  if (ctx?.roleCode !== "admin") {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <p className="max-w-2xl text-sm text-muted-foreground">
          Students rate their teachers, and only the college&apos;s administrator reads the ratings. A teacher does not see
          ratings, their own included.
        </p>
      </div>
    );
  }

  const rows = await listRatingSummary();
  const [sectionId, subjectId, staffId] = (open ?? "").split(":");
  const feedback = open && staffId ? await listRatingFeedback(sectionId, subjectId, staffId) : [];
  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      <RatingSummary rows={rows} open={open ?? null} feedback={feedback} />
    </div>
  );
}
