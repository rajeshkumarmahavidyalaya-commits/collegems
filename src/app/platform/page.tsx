import type { Metadata } from "next";
import { Building2, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { listColleges } from "./actions";
import { PlanControl } from "./plan-control";

export const metadata: Metadata = { title: "Platform" };

/**
 * The operator console.
 *
 * Deliberately outside the `(app)` group: it has no tenant, so it has no
 * academic year, no permission matrix and no school name to put in a sidebar.
 * Rendering it inside the school shell would mean inventing all four.
 *
 * **Metadata only.** Colleges, plans, usage, health — and no student, guardian,
 * fee or mark anywhere in it. That is a decision rather than a limitation of
 * what a definer function could return, and it is the decision that makes the
 * cost of a mistake here *counts* rather than *children*. Support impersonation
 * is not built: it needs consent, a time limit and an audit trail the college
 * itself can read, and it should arrive as a migration that argues for itself.
 */
export default async function PlatformPage() {
  const [colleges, locale] = await Promise.all([listColleges(), getLocale()]);

  // Null means Postgres refused this caller. Not the same as an empty list, and
  // the two must not render as the same screen: one is "you should not be
  // here", the other is "there are no customers yet".
  if (colleges === null) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="rounded-full bg-muted p-3">
              <ShieldAlert className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">This is not available</p>
            <p className="text-sm text-muted-foreground">
              This area is for platform staff. If you are looking for your college, it is on the
              home page.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const totals = colleges.reduce(
    (acc, c) => ({
      students: acc.students + c.students,
      staff: acc.staff + c.staff,
      paying: acc.paying + (c.planStatus === "active" ? 1 : 0),
      trialing: acc.trialing + (c.planStatus === "trialing" ? 1 : 0),
    }),
    { students: 0, staff: 0, paying: 0, trialing: 0 },
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6 sm:p-10">
      <div>
        <h1 className="text-2xl font-semibold">Platform</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every college on this deployment. Counts and plans only — no college&apos;s records are
          readable from here.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Colleges" value={colleges.length} />
        <Stat label="Paying" value={totals.paying} />
        <Stat label="On trial" value={totals.trialing} />
        <Stat label="Children enrolled" value={totals.students} />
      </div>

      {colleges.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Building2 className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">No colleges yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The first one appears here as soon as somebody signs up and starts a school.
            </p>
          </CardContent>
        </Card>
      ) : (
        colleges.map((c) => (
          <Card key={c.tenantId}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {c.name}
                <Badge variant={c.planStatus === "active" ? "default" : "outline"}>
                  {c.planCode ?? "no plan"} · {c.planStatus ?? "—"}
                </Badge>
                {c.overLimit && (
                  <Badge variant="destructive" className="gap-1">
                    <TriangleAlert className="size-3" aria-hidden="true" />
                    over limit
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                {c.slug}.schoolos.app · {c.timezone} · since{" "}
                {formatDate(c.createdAt, locale)}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Figure
                  label="Children"
                  value={c.students}
                  limit={c.studentLimit}
                  over={c.overLimit}
                />
                <Figure label="Staff" value={c.staff} limit={c.staffLimit} over={false} />
                <Figure label="Logins" value={c.logins} limit={null} over={false} />
                <div>
                  <dt className="text-xs text-muted-foreground">Last activity</dt>
                  <dd className="mt-0.5 text-sm">
                    {/* A timestamp, never the change itself: "is this college
                        alive" answered without reading anything it wrote. */}
                    {c.lastActivity ? formatDate(c.lastActivity, locale) : "—"}
                  </dd>
                </div>
              </dl>

              <PlanControl
                tenantId={c.tenantId}
                name={c.name}
                planCode={c.planCode}
                planStatus={c.planStatus}
              />
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
    </div>
  );
}

function Figure({
  label,
  value,
  limit,
  over,
}: {
  label: string;
  value: number;
  limit: number | null;
  over: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-mono text-sm tabular-nums ${over ? "text-destructive" : ""}`}>
        {value}
        {/* Null is "no ceiling", never "a ceiling of zero" — the same
            distinction the college's own plan screen draws. */}
        {limit === null ? (
          <span className="font-sans text-muted-foreground"> · no limit</span>
        ) : (
          <span className="font-sans text-muted-foreground"> of {limit}</span>
        )}
      </dd>
    </div>
  );
}
