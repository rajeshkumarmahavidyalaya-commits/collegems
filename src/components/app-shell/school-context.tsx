"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, School, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/providers/i18n-provider";
import { chooseYear } from "@/app/(app)/year-actions";

/**
 * The reference's lavender band: the school's name and the session it is
 * working in. For the super admin the name is a link to School Management,
 * where they choose a school (0323, 0325).
 *
 * The working year is school-wide, decided on the guarded Academic years
 * screen with its promotion checks. The selector here only opens a year to
 * read (0355): every read follows it, and Postgres makes any year but the
 * working one read-only, so it can never show one year while writes file into
 * another (rule 2). The page says so in a banner while one is open.
 */
export function SchoolContext({
  tenantName,
  currentSessionName,
  currentSessionId,
  years = [],
  canManageSessions = false,
  canChooseSchool = false,
}: {
  tenantName: string;
  currentSessionName: string | null;
  currentSessionId?: string | null;
  years?: { id: string; name: string; isCurrent: boolean }[];
  canManageSessions?: boolean;
  canChooseSchool?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const session = currentSessionName ?? t("context.notSet");

  function open(id: string) {
    start(async () => {
      const r = await chooseYear(id);
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  }
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
        {years.length > 1 ? (
          <label className="relative inline-flex items-center">
            <span className="sr-only">{t("context.chooseYear")}</span>
            <select
              className="school-context-selector appearance-none pe-7"
              value={currentSessionId ?? ""}
              onChange={(e) => open(e.target.value)}
              disabled={pending}
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.isCurrent ? t("context.workingYear", { name: y.name }) : y.name}
                </option>
              ))}
            </select>
            {pending ? (
              <Loader2 className="pointer-events-none absolute end-2 size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ChevronDown className="pointer-events-none absolute end-2 size-3.5" aria-hidden="true" />
            )}
          </label>
        ) : (
          <span className="school-context-selector">{session}</span>
        )}
        {canManageSessions && (
          <Link
            href="/academics/sessions"
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
            aria-label={t("context.openSessions", { name: session })}
            title={t("context.openSessions", { name: session })}
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </section>
  );
}
