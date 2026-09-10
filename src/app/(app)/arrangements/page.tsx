import { BedDouble, Bus, CircleSlash, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { getLocale } from "@/lib/i18n/server";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { listMyChildrensArrangements, type Arrangement } from "./actions";

export const metadata = { title: "Bus and boarding" };

/**
 * The family's side of transport and the hostel — the other door that was
 * missing.
 *
 * Nothing here is a new read path or a new permission. `transport_for_student`
 * and `hostel_for_student` have been `SECURITY INVOKER` since their modules
 * shipped, and RLS already scopes them to a guardian's own children — probed as
 * a parent: their own child's seat and bed, and **0 rows** for another child in
 * the same school. What was missing was a link. Every transport and hostel
 * screen in the product is `roles: ["admin", "teacher", "accountant"]`, so the
 * arrangement a family is billed for every month was visible on a phone and
 * nowhere on the web.
 *
 * That is rule 4's sentence about the fee screens, arriving one module along:
 * **a charge with no link is a bill a family cannot check.**
 */
export default async function ArrangementsPage() {
  const [ctx, locale, rows] = await Promise.all([
    getUserContext(),
    getLocale(),
    listMyChildrensArrangements(),
  ]);

  // Not a permission check — `listMyChildrensArrangements` is narrowed to the
  // relationship and a member of staff gets `[]` from it whatever they may
  // read. This decides only which empty sentence is true: a bursar landing here
  // has not run out of children, they are on the wrong screen.
  const isFamily = ctx?.roleCode === "parent" || ctx?.roleCode === "student";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Bus and boarding</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The travel and boarding arrangements the school has on record, and what each one costs a
          month.
        </p>
      </div>

      {!isFamily ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Bus className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">This screen is for families</p>
            <p className="max-w-md text-sm text-muted-foreground">
              It shows one child&apos;s own arrangements. For the whole school&apos;s routes and
              houses, use Transport and Hostel.
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Bus className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">No children are linked to this login yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              The school office links a family login to the children it belongs to. Ask them to
              check if this looks wrong.
            </p>
          </CardContent>
        </Card>
      ) : (
        rows.map(({ child, transport, hostel, past }) => (
          <Card key={child.studentId}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {child.name}
                {child.sectionLabel && (
                  <Badge variant="secondary" className="font-normal">
                    {child.sectionLabel}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {child.relationship === "self"
                  ? "You"
                  : `Your ${child.relationship}`}{" "}
                · {child.admissionNumber}
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4 sm:grid-cols-2">
              <ArrangementBlock
                icon={<Bus className="size-4 text-muted-foreground" aria-hidden="true" />}
                heading="School bus"
                empty="Not on a school bus."
                arrangement={transport}
                locale={locale}
              />
              <ArrangementBlock
                icon={<BedDouble className="size-4 text-muted-foreground" aria-hidden="true" />}
                heading="Boarding"
                empty="Not boarding — a day scholar."
                arrangement={hostel}
                locale={locale}
              />

              {past.length > 0 && (
                <div className="sm:col-span-2">
                  {/*
                    Shown rather than dropped. A family checking an old invoice
                    needs to see that the seat ran until March, and a screen
                    that hides finished arrangements is how somebody concludes
                    the school lost the record.
                  */}
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Previously</p>
                  <ul className="flex flex-col gap-1">
                    {past.map((p) => (
                      <li
                        key={`${p.kind}-${p.label}-${p.endedOn}`}
                        className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
                      >
                        <CircleSlash className="size-3.5 shrink-0" aria-hidden="true" />
                        <span>{p.label}</span>
                        <span aria-hidden="true">·</span>
                        <span>ended {formatDate(`${p.endedOn}T00:00:00Z`, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function ArrangementBlock({
  icon,
  heading,
  empty,
  arrangement,
  locale,
}: {
  icon: React.ReactNode;
  heading: string;
  empty: string;
  arrangement: Arrangement | null;
  locale: Awaited<ReturnType<typeof getLocale>>;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {heading}
      </p>

      {!arrangement ? (
        // An arrangement that has ended is *absent* here, not shown as active.
        // That is the whole point of resolving by date rather than reading the
        // status column, and it is the sentence a day scholar should see.
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1 text-sm">
          <p className="font-medium">{arrangement.title}</p>
          <p className="text-muted-foreground">{arrangement.detail}</p>
          {arrangement.extra && (
            <p className="text-xs text-muted-foreground">{arrangement.extra}</p>
          )}

          {(arrangement.pickup || arrangement.drop) && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" aria-hidden="true" />
              {/* A missing time is left out rather than printed as 00:00 —
                  a pickup-only route has no drop time, and inventing one
                  would put a child at a stop at midnight. */}
              {arrangement.pickup && <span>Pickup {arrangement.pickup.slice(0, 5)}</span>}
              {arrangement.drop && <span>Drop {arrangement.drop.slice(0, 5)}</span>}
            </p>
          )}

          {arrangement.fare !== null && (
            <p className="mt-1 font-mono text-sm tabular-nums">
              {formatCurrency(arrangement.fare, locale)}
              <span className="font-sans text-muted-foreground"> a month</span>
            </p>
          )}

          {arrangement.endsOn && (
            <p className="mt-1 text-xs text-muted-foreground">
              Runs until {formatDate(`${arrangement.endsOn}T00:00:00Z`, locale)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
