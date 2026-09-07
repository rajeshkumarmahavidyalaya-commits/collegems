import Link from "next/link";
import { ArrowLeft, UserCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { periodLabel } from "@/lib/validations/substitutions";
import { listGaps, listMyCovers, listProblems } from "./actions";
import { CoverBoard } from "./cover-board";
import { DayPicker } from "./day-picker";

export const metadata = { title: "Cover" };

/**
 * The morning: who is away, which lessons have nobody in front of them, and
 * what was arranged yesterday that is now wrong.
 *
 * The page has two shapes and they are not the same list with a button hidden.
 * An administrator asks *"which classes have nobody in front of them"*, which
 * needs to know who is off sick. A teacher asks *"where do I have to be"*,
 * which does not — and, per migration 0158, cannot: `substitution_gaps` is
 * built on a table whose RLS is row-ownership, so it answers a teacher with a
 * plausible zero rather than an error. Gating on `substitutions.manage` is what
 * stops that empty list ever being shown as if it meant a quiet morning.
 */
export default async function SubstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const onDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "") ? params.date : undefined;

  const canManage = await hasPermission("substitutions.manage");

  const [gaps, problems, myCovers] = await Promise.all([
    canManage ? listGaps(onDate) : Promise.resolve([]),
    canManage ? listProblems(onDate) : Promise.resolve([]),
    listMyCovers(onDate),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/timetable"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Timetable
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Cover</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Who stands in when a teacher is away. Somebody is &ldquo;away&rdquo; because their leave
          was approved or because the register says so &mdash; both count, and neither is entered
          here.
        </p>
      </div>

      <DayPicker date={onDate} />

      <section aria-labelledby="my-covers-heading" className="flex flex-col gap-3">
        <h2 id="my-covers-heading" className="text-lg font-semibold">
          What you are covering
        </h2>

        {myCovers.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nothing extra for you</CardTitle>
              <CardDescription>
                You are not covering anybody&rsquo;s class on this day. Your own timetable is
                unchanged.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {myCovers.map((cover, index) => (
              <li key={`${cover.periodNumber}-${index}`}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <UserCheck className="size-4 text-primary" aria-hidden="true" />
                      {cover.sectionLabel}
                      <span className="text-sm font-normal text-muted-foreground">
                        {cover.subjectName}
                      </span>
                    </CardTitle>
                    <CardDescription>
                      {periodLabel(cover.periodNumber, cover.startsAt)} &middot; covering for{" "}
                      {cover.coveringFor}
                      {cover.room ? ` · ${cover.room}` : ""}
                    </CardDescription>
                  </CardHeader>
                  {cover.note && (
                    <CardContent className="pt-0 text-sm text-muted-foreground">
                      {cover.note}
                    </CardContent>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <CoverBoard gaps={gaps} problems={problems} onDate={onDate} />
      ) : (
        <Alert>
          <UserCheck className="size-4" aria-hidden="true" />
          <AlertTitle>The whole roster is the office&rsquo;s</AlertTitle>
          <AlertDescription>
            Arranging cover means spending a colleague&rsquo;s free period, so only the office does
            it. Who is off sick is not shown here either &mdash; that is a fact about them, not
            about your day.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
