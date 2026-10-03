"use client";

import { useActionState } from "react";
import { Info, Loader2, Mail, MapPin, Phone, School } from "lucide-react";
import { useT } from "@/components/providers/i18n-provider";
import { switchSchool, type MySchool, type SwitchState } from "./actions";

/**
 * One school on the School Management dashboard, as the reference draws it:
 * an icon, the name, phone, email, address and status, the current one in
 * the brand colour. The whole card is the button that opens the school.
 */
export function SchoolCard({ school }: { school: MySchool }) {
  const t = useT();
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
              "flex size-12 shrink-0 items-center justify-center rounded-lg",
              current ? "bg-primary-foreground text-primary" : "bg-muted text-primary",
            ].join(" ")}
          >
            <School className="size-6" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold italic">{school.name}</span>
        </span>
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
