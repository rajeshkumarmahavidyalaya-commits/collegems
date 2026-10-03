"use client";

import Link from "next/link";
import { ChevronDown, School } from "lucide-react";
import { useT } from "@/components/providers/i18n-provider";

/**
 * The reference's lavender band: the school's name and the session it is
 * working in. For the super admin the name is a link to School Management,
 * where they choose a school (0323, 0325). The session is school-wide here, decided on the guarded
 * Academic years screen with its promotion checks, so the "selector" is a link
 * to that screen for somebody who may change it -- never a browser-only filter
 * that would show one year while every write files into another (rule 2).
 */
export function SchoolContext({
  tenantName,
  currentSessionName,
  canManageSessions = false,
  canChooseSchool = false,
}: {
  tenantName: string;
  currentSessionName: string | null;
  canManageSessions?: boolean;
  canChooseSchool?: boolean;
}) {
  const t = useT();
  const session = currentSessionName ?? t("context.notSet");
  return (
    <section className="school-context" aria-label={t("context.region")} data-print="hide">
      <div className="school-context-title">
        <School aria-hidden="true" />
        {/* For the super admin the school's name opens School Management,
            where they choose a school (0323, 0325). For everybody else it is
            just the name of the school they work in. */}
        {canChooseSchool ? (
          <Link
            href="/schools"
            className="underline-offset-4 hover:underline"
            aria-label={t("context.switchSchool", { name: tenantName || "SchoolOS" })}
          >
            {tenantName || "SchoolOS"}
          </Link>
        ) : (
          <span>{tenantName || "SchoolOS"}</span>
        )}
        {currentSessionName && <span className="school-context-year">{currentSessionName}</span>}
      </div>
      <div className="school-context-session">
        <span>{t("context.currentSession")}</span>
        {canManageSessions ? (
          <Link
            href="/academics/sessions"
            className="school-context-selector"
            aria-label={t("context.openSessions", { name: session })}
          >
            {session}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="school-context-selector">{session}</span>
        )}
      </div>
    </section>
  );
}
