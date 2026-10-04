"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Mail, MapPin, Pause, Phone, Play, School } from "lucide-react";
import { toast } from "sonner";
import { useI18n, useT } from "@/components/providers/i18n-provider";
import { setSchoolActive, switchSchool, type MySchool, type SchoolFigures, type SwitchState } from "./actions";

/**
 * One school on the School Management dashboard, as the reference draws it:
 * an icon, the name, phone, email, address and status, the current one in
 * the brand colour. The whole card is the button that opens the school.
 */
export function SchoolCard({ school, figures }: { school: MySchool; figures?: SchoolFigures }) {
  const t = useT();
  const { formatCurrency, formatNumber } = useI18n();
  const [state, formAction, pending] = useActionState<SwitchState, FormData>(
    switchSchool.bind(null, school.tenantId),
    { error: null },
  );
  const active = school.planStatus === "active" || school.planStatus === "trialing";
  const current = school.isCurrent;
  const disabled = !school.isActive || pending;

  return (
    <form action={formAction} className="h-full">
      <button
        type="submit"
        disabled={disabled}
        aria-current={current ? "true" : undefined}
        aria-label={current ? `${school.name}: ${t("schools.current")}` : t("schools.open", { name: school.name })}
        className={[
          "school-card flex h-full w-full cursor-pointer flex-col gap-3 rounded-xl border p-6 text-start shadow-sm transition-shadow",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70",
          current ? "border-primary bg-primary text-primary-foreground" : "bg-card text-card-foreground",
        ].join(" ")}
      >
        <span className="flex items-center gap-4">
          <span
            className={[
              "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg",
              current ? "bg-primary-foreground text-primary" : "bg-muted text-primary",
            ].join(" ")}
          >
            {figures?.logo ? (
              // A small data URL from the school's own row (0326).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={figures.logo} alt="" className="size-full object-contain" />
            ) : (
              <School className="size-6" aria-hidden="true" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-lg font-semibold italic">{school.name}</span>
            {figures?.isPaused && (
              <span className="mt-0.5 w-fit rounded bg-warning px-1.5 py-0.5 text-xs font-semibold text-warning-foreground">
                Paused
              </span>
            )}
          </span>
        </span>
        {figures && (
          // Totals only, and only for a school this login administers (0326).
          <span
            className={[
              "grid grid-cols-3 gap-2 rounded-lg p-2 text-center",
              current ? "bg-primary-foreground/15" : "bg-muted/60",
            ].join(" ")}
          >
            <span className="flex flex-col">
              <span className="text-base font-semibold tabular-nums">{formatNumber(figures.studentsOnRoll)}</span>
              <span className="text-[11px] leading-tight opacity-80">Students on roll</span>
            </span>
            <span className="flex flex-col">
              <span className="text-base font-semibold tabular-nums">{formatCurrency(figures.collectedThisMonth)}</span>
              <span className="text-[11px] leading-tight opacity-80">Collected this month</span>
            </span>
            <span className="flex flex-col">
              <span className="text-base font-semibold tabular-nums">{formatCurrency(figures.duesOutstanding)}</span>
              <span className="text-[11px] leading-tight opacity-80">Dues outstanding</span>
            </span>
          </span>
        )}
        <span className="flex flex-col gap-1.5 text-sm">
          {school.phone && (
            <span className="flex items-start gap-2">
              <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium">{t("schools.phone")}:</span> {school.phone}
              </span>
            </span>
          )}
          {school.email && (
            <span className="flex items-start gap-2">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="break-all">
                <span className="font-medium">{t("schools.email")}:</span> {school.email}
              </span>
            </span>
          )}
          {school.address && (
            <span className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium">{t("schools.address")}:</span> {school.address}
              </span>
            </span>
          )}
          <span className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium">{t("schools.status")}:</span>{" "}
              {active ? t("schools.status.active") : t("schools.status.inactive")}
            </span>
          </span>
          <span className={current ? "text-primary-foreground/90" : "text-muted-foreground"}>
            {t("schools.role")}: {school.roleName}
          </span>
        </span>
        {current && <span className="mt-auto text-xs font-semibold uppercase tracking-wide">{t("schools.current")}</span>}
        {!school.isActive && <span className="mt-auto text-xs font-semibold">{t("schools.switchedOff")}</span>}
        {pending && (
          <span className="mt-auto flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {t("schools.switching", { name: school.name })}
          </span>
        )}
      </button>
      <p aria-live="assertive" className="mt-1 min-h-0 text-sm">
        {state.error && (
          <span role="alert" className="font-medium text-destructive">
            {state.error}
          </span>
        )}
      </p>
    </form>
  );
}

/** The Schools table's Action: open that school, through the same switch. */
export function OpenSchoolButton({ tenantId, name, disabled }: { tenantId: string; name: string; disabled?: boolean }) {
  const t = useT();
  const [state, formAction, pending] = useActionState<SwitchState, FormData>(switchSchool.bind(null, tenantId), {
    error: null,
  });
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={disabled || pending}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        {t("schools.open", { name })}
      </button>
      {state.error && (
        <span role="alert" className="text-xs font-medium text-destructive">
          {state.error}
        </span>
      )}
    </form>
  );
}

/**
 * Pause or resume a school (0326). Paused, its members other than its
 * administrators see a notice instead of the app, and its online form closes.
 * Not a boundary -- logins and data are untouched -- so the confirmation says
 * exactly that.
 */
export function PauseSchoolButton({ tenantId, name, paused }: { tenantId: string; name: string; paused: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const ask = paused
          ? `Resume ${name}? Its staff, students and families can use it again.`
          : `Pause ${name}? Everybody except its administrators will see a "paused" notice instead of the app, and its online application form closes. Nothing is deleted, and you can resume it at any time.`;
        if (!window.confirm(ask)) return;
        start(async () => {
          const r = await setSchoolActive(tenantId, paused);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.data.active ? `${name} is active again.` : `${name} is paused.`);
          router.refresh();
        });
      }}
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : paused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
      {paused ? "Resume" : "Pause"}
    </button>
  );
}
