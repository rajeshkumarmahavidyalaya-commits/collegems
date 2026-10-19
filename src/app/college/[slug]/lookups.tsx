"use client";

import { useActionState, useEffect, useRef } from "react";
import { BadgeCheck, Loader2, Printer, TriangleAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/components/providers/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/en";
import {
  PUBLIC_LIMITS,
  timeRange,
  type AdmitCard,
  type CertificateCheck,
  type PublicResult,
} from "@/lib/validations/public-pages";
import { checkCertificate, findAdmitCard, findResults, type LookupState } from "./actions";
import { selectClass } from "./forms";

/** A date the database stored as a calendar day: formatted in UTC so no zone moves it. */
const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" };

function LookupError({ state }: { state: { errorKey?: string; error?: string } }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const message = state.errorKey ? t(state.errorKey as MessageKey) : state.error;
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message, state]);
  if (!message) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive outline-none"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function TextInput({
  name,
  label,
  value,
  type = "text",
  ltr,
}: {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "date";
  ltr?: boolean;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={`lookup-${name}`}>{label}</Label>
      <Input
        id={`lookup-${name}`}
        name={name}
        type={type}
        defaultValue={value ?? ""}
        required
        aria-required
        maxLength={type === "text" ? PUBLIC_LIMITS.lookup : undefined}
        dir={ltr ? "ltr" : undefined}
        autoComplete="off"
      />
    </div>
  );
}

function Submit({ pending }: { pending: boolean }) {
  const { t } = useI18n();
  return (
    <div>
      <Button type="submit" disabled={pending} aria-disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t("public.lookup.searching")}
          </>
        ) : (
          t("public.lookup.submit")
        )}
      </Button>
    </div>
  );
}

function PrintButton() {
  const { t } = useI18n();
  return (
    <Button type="button" variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" aria-hidden="true" />
      {t("public.print")}
    </Button>
  );
}

// ------------------------------------------------------------ certificate --

export function CertificateLookup({ slug }: { slug: string }) {
  const { t, formatDate } = useI18n();
  const [state, action, pending] = useActionState(
    checkCertificate.bind(null, slug),
    {} as LookupState<CertificateCheck>,
  );
  const v = state.values ?? {};
  const r = state.result;
  return (
    <div className="flex flex-col gap-6">
      <form key={JSON.stringify(v)} action={action} className="flex flex-col gap-4" noValidate>
        <LookupError state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput name="serial" label={t("public.verify.serial")} value={v.serial} ltr />
          <TextInput name="dob" type="date" label={t("apply.dateOfBirth")} value={v.dob} />
        </div>
        <p className="text-xs text-muted-foreground">{t("public.lookup.hint")}</p>
        <Submit pending={pending} />
      </form>
      {r ? (
        <section
          role="status"
          className={`flex flex-col gap-4 rounded-lg border px-5 py-5 ${r.cancelled ? "border-destructive/40 bg-destructive/5" : "border-primary/40 bg-primary/5"}`}
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {r.cancelled ? (
              <XCircle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <BadgeCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
            )}
            {r.cancelled
              ? t("public.verify.cancelled", { date: formatDate(r.cancelledOn, DAY) })
              : t("public.verify.valid")}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Fact label={t("public.verify.serial")} value={<bdi className="font-mono">{r.serial}</bdi>} />
            <Fact label={t("public.verify.certificate")} value={r.certificate} />
            <Fact label={t("public.verify.holder")} value={r.holder} />
            <Fact label={t("public.verify.issuedOn")} value={formatDate(r.issuedOn, DAY)} />
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------- admit card --

export function AdmitCardLookup({ slug, exams }: { slug: string; exams: { id: string; name: string }[] }) {
  const { t, formatDate } = useI18n();
  const [state, action, pending] = useActionState(findAdmitCard.bind(null, slug), {} as LookupState<AdmitCard>);
  const v = state.values ?? {};
  const card = state.result;

  if (exams.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
        {t("public.admit.noExams")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form key={JSON.stringify(v)} action={action} className="flex flex-col gap-4 print:hidden" noValidate>
        <LookupError state={state} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid content-start gap-2">
            <Label htmlFor="lookup-exam">{t("public.admit.exam")}</Label>
            <select id="lookup-exam" name="exam" defaultValue={v.exam ?? exams[0]?.id} className={selectClass} required>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <TextInput name="admission" label={t("public.lookup.admissionNumber")} value={v.admission} ltr />
          <TextInput name="dob" type="date" label={t("apply.dateOfBirth")} value={v.dob} />
        </div>
        <p className="text-xs text-muted-foreground">{t("public.lookup.hint")}</p>
        <Submit pending={pending} />
      </form>
      {card ? (
        <section role="status" className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-foreground">{t("public.admit.card", { exam: card.exam })}</h2>
              {card.centre ? (
                <p className="text-sm text-muted-foreground">{t("public.exams.centre", { centre: card.centre })}</p>
              ) : null}
            </div>
            <PrintButton />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <Fact label={t("public.admit.student")} value={card.student} />
            <Fact label={t("public.lookup.admissionNumber")} value={<bdi className="font-mono">{card.admissionNumber}</bdi>} />
            <Fact label={t("public.exams.class")} value={card.className} />
            <Fact label={t("public.admit.roll")} value={card.rollNumber ?? "—"} />
          </dl>
          {card.papers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("public.exams.noPapers")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-muted-foreground">
                    <th className="py-2 pe-3 text-start font-medium">{t("public.exams.subject")}</th>
                    <th className="py-2 pe-3 text-start font-medium">{t("public.exams.date")}</th>
                    <th className="py-2 pe-3 text-start font-medium">{t("public.exams.time")}</th>
                    <th className="py-2 pe-3 text-start font-medium">{t("public.admit.room")}</th>
                    <th className="py-2 text-start font-medium">{t("public.admit.seat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {card.papers.map((p, i) => (
                    <tr key={`${p.subject}-${i}`} className="border-b border-border last:border-0">
                      <td className="py-2 pe-3">{p.subject}</td>
                      <td className="py-2 pe-3 whitespace-nowrap">
                        {p.date ? formatDate(p.date, DAY) : t("public.exams.notFixed")}
                      </td>
                      <td className="py-2 pe-3 whitespace-nowrap tabular-nums">
                        <bdi>{timeRange(p.startsAt, p.endsAt) ?? "—"}</bdi>
                      </td>
                      <td className="py-2 pe-3">{p.room ?? "—"}</td>
                      <td className="py-2 tabular-nums">{p.seat ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("public.admit.note")}</p>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- results --

export function ResultsLookup({ slug }: { slug: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const [state, action, pending] = useActionState(
    findResults.bind(null, slug),
    {} as LookupState<{ student: string; results: PublicResult[] }>,
  );
  const v = state.values ?? {};
  const found = state.result;
  const num = (n: number | null, digits = 2) =>
    n == null ? "—" : formatNumber(n, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const outcome = (r: string | null) =>
    r === "pass" || r === "fail" || r === "incomplete" ? t(`public.results.${r}`) : r ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <form key={JSON.stringify(v)} action={action} className="flex flex-col gap-4 print:hidden" noValidate>
        <LookupError state={state} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput name="admission" label={t("public.lookup.admissionNumber")} value={v.admission} ltr />
          <TextInput name="dob" type="date" label={t("apply.dateOfBirth")} value={v.dob} />
        </div>
        <p className="text-xs text-muted-foreground">{t("public.lookup.hint")}</p>
        <Submit pending={pending} />
      </form>
      {found ? (
        <section role="status" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">{found.student}</h2>
            <PrintButton />
          </div>
          {found.results.map((r, i) => (
            <article key={`${r.exam}-${i}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <h3 className="font-semibold text-foreground">{r.exam}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("public.results.published", { session: r.session ?? "", date: formatDate(r.publishedOn, DAY) })}
                  </p>
                </div>
                {/* Meaning in the word, colour only as a second channel. */}
                <Badge variant={r.result === "fail" ? "destructive" : r.result === "pass" ? "default" : "secondary"}>
                  {outcome(r.result)}
                </Badge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-4">
                <Fact label={t("public.results.total")} value={`${num(r.total)} / ${num(r.max)}`} />
                <Fact label={t("public.results.percentage")} value={r.percentage == null ? "—" : `${num(r.percentage)}%`} />
                <Fact label={t("public.results.grade")} value={r.grade ?? "—"} />
                <Fact
                  label={t("public.results.result")}
                  value={r.rank != null && r.cohort != null ? t("public.results.rank", { rank: r.rank, cohort: r.cohort }) : outcome(r.result)}
                />
              </dl>
              {r.subjects.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pe-3 text-start font-medium">{t("public.exams.subject")}</th>
                        <th className="py-2 pe-3 text-end font-medium">{t("public.results.marks")}</th>
                        <th className="py-2 text-end font-medium">{t("public.results.max")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.subjects.map((s, j) => (
                        <tr key={`${s.subject}-${j}`} className="border-b border-border last:border-0">
                          <td className="py-2 pe-3">
                            {s.subject}
                            {s.passed === false && !s.absent ? (
                              <span className="ms-2 text-xs text-destructive">({t("public.results.fail")})</span>
                            ) : null}
                          </td>
                          <td className="py-2 pe-3 text-end tabular-nums">
                            {s.absent ? t("public.results.absent") : num(s.obtained)}
                          </td>
                          <td className="py-2 text-end tabular-nums">{num(s.max)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
