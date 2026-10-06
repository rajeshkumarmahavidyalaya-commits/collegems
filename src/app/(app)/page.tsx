import { Suspense } from "react";
import Link from "next/link";
import { getUserContext } from "@/lib/auth/context";
import { getLocale, getT } from "@/lib/i18n/server";
import { hasPermission } from "@/lib/auth/permissions";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { createClient } from "@/lib/supabase/server";
import { FamilyHome } from "./family/family-home";
import { pickChild } from "./family/actions";
import {
  CalendarSkeleton,
  DashboardCalendar,
  DashboardDetail,
  DashboardFigures,
  DashboardLists,
  DashboardModules,
  DetailSkeleton,
  FiguresSkeleton,
  ListsSkeleton,
  ModulesSkeleton,
} from "@/components/dashboard/dashboard-sections";

export const metadata = { title: "Dashboard" };

/**
 * The home page: a brief of everything.
 *
 * It used to make seven separate queries and count three hundred enrolment rows
 * in JavaScript to draw twelve bars. It now makes one call to
 * `dashboard_summary()`, which aggregates in Postgres and hands back a single
 * jsonb document. Rule 7's test is boundedness, and one row is bounded however
 * large the school gets.
 *
 * The page itself only draws the title bar; each section is its own component
 * in `dashboard-sections.tsx` behind a `<Suspense>`, so it streams in when its
 * read answers. The reads are memoised per request, so the sections still
 * share that one summary call.
 *
 * Two consequences worth knowing before editing these files:
 *
 *   - **What each role sees is decided in Postgres, not here.** Every block is
 *     gated on the permission matrix inside the function, and the blocks a role
 *     may not see come back named in `withheld`. So there is no `if (isAdmin)`
 *     in this file, and adding one would be a second answer to a question that
 *     already has one.
 *   - **A card that is absent is not the same as a card that is empty.** A
 *     withheld block is explained at the foot of the page; an empty one — no
 *     exam published, no register taken — says so in its own words.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; child?: string }>;
}) {
  // The buttons are drawn on the permissions their screens check; the screens
  // remain the gate (rule 4).
  const [{ month, child: requested }, ctx, locale, t, canConfigure, canInvite] = await Promise.all([
    searchParams,
    getUserContext(),
    getLocale(),
    getT(),
    hasPermission("academics.manage"),
    hasPermission("users.manage"),
  ]);
  // A family gets the reference's Student or Parent Dashboard rather than the
  // college's cards with their own rows in them ("Students with Dues: 1" was
  // their own child). The tier decides what is shown (0208); what they may
  // read is still decided row by row in Postgres.
  if (ctx?.roleTier === "student") {
    const supabase = await createClient();
    const [{ children, child }, { data: tenant }] = await Promise.all([
      pickChild(requested),
      supabase.from("tenants").select("timezone").limit(1).maybeSingle(),
    ]);
    // The school's own date, never the server's (Vercel runs in UTC).
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tenant?.timezone ?? "Asia/Kolkata" }).format(new Date());
    return (
      <FamilyHome
        childList={children}
        child={child}
        sessionId={ctx.currentSessionId}
        sessionName={ctx.currentSessionName}
        today={today}
        month={month}
        locale={locale}
        isParent={ctx.roleSubject === "guardian"}
      />
    );
  }

  const scope = {
    sessionId: ctx?.currentSessionId ?? null,
    sessionName: ctx?.currentSessionName ?? null,
    locale,
  };

  // The title bar and its three buttons draw at once; every section below
  // streams in when its own read answers (lazy loading), behind a placeholder
  // of the same height so nothing jumps when it arrives.
  return (
    <div className="flex flex-col gap-6">
      <PageToolbar title={t("dashboard.toolbarTitle")}>
        {canConfigure && (
          <Button asChild>
            <Link href="/academics?tab=classes">{t("dashboard.ref.addClass")}</Link>
          </Button>
        )}
        {canConfigure && (
          <Button asChild>
            <Link href="/academics?tab=classes">{t("dashboard.ref.manageSections")}</Link>
          </Button>
        )}
        {canInvite && (
          <Button asChild>
            <Link href="/settings/team">{t("dashboard.ref.assignAdmins")}</Link>
          </Button>
        )}
      </PageToolbar>

      <Suspense fallback={<FiguresSkeleton />}>
        <DashboardFigures {...scope} />
      </Suspense>

      <Suspense fallback={<CalendarSkeleton />}>
        <DashboardCalendar month={month} locale={locale} />
      </Suspense>

      <Suspense fallback={<ListsSkeleton />}>
        <DashboardLists {...scope} />
      </Suspense>

      <Suspense fallback={<ModulesSkeleton />}>
        <DashboardModules roleTier={ctx?.roleTier ?? null} roleSubject={ctx?.roleSubject ?? null} />
      </Suspense>

      <Suspense fallback={<DetailSkeleton />}>
        <DashboardDetail {...scope} />
      </Suspense>
    </div>
  );
}
