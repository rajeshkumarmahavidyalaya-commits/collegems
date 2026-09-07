import Link from "next/link";
import { CalendarX2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCoverage } from "../actions";

/**
 * Which registers were never taken.
 *
 * Deliberately on the report page rather than the marking page: it is a
 * question about the term, asked by whoever is answerable for it, and putting
 * it in front of a teacher who is about to mark today's register is putting the
 * wrong number in front of the right person.
 */
export async function CoverageCard({ from, to }: { from: string; to: string }) {
  let rows;
  try {
    rows = await getCoverage(from, to);
  } catch (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registers never taken</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "That range could not be counted."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const withGaps = rows.filter((r) => r.daysMissing > 0);
  const workingDays = rows[0]?.workingDays ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarX2 className="size-4 text-muted-foreground" aria-hidden="true" />
          Registers never taken
        </CardTitle>
        <CardDescription>
          {workingDays} school days in this range, weekends and holidays excluded. An attendance
          percentage is over what was marked, so it cannot show a day nobody marked — this can.{" "}
          <Link href="/reports" className="underline underline-offset-4">
            The day-by-day list
          </Link>{" "}
          is in the reports catalog.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No classes in the current session.
          </p>
        ) : withGaps.length === 0 ? (
          <p className="py-6 text-center text-sm text-success">
            Every class has a register for every school day in this range.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {withGaps.slice(0, 12).map((row) => (
              <li
                key={row.sectionId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border p-3 text-sm"
              >
                <span className="font-medium">{row.sectionLabel}</span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span className="font-mono tabular-nums">
                    {row.daysMarked} of {row.workingDays}
                  </span>
                  {/* The word carries the meaning; the tint is the extra. */}
                  <Badge variant={row.daysMissing > 5 ? "warning" : "outline"}>
                    {row.daysMissing} missing
                  </Badge>
                </span>
              </li>
            ))}
            {withGaps.length > 12 && (
              <li className="text-xs text-muted-foreground">
                …and {withGaps.length - 12} more classes with gaps. The full list is the{" "}
                <Link href="/reports" className="underline underline-offset-4">
                  reports catalog
                </Link>
                .
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
