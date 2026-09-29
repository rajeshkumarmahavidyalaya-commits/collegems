import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BedDouble,
  Bus,
  CheckCircle2,
  Circle,
  FileText,
  IdCard,
  IndianRupee,
  UserPlus,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { getUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatCurrency } from "@/lib/i18n/format";
import { isCurrentArrangement } from "@/lib/validations/arrangements";
import { getStudent } from "../../actions";
import { bedOptions, busStopOptions, giveBed, giveBusSeat } from "../../arrangement-actions";
import { inviteFamily } from "../../admitted-actions";
import { findLetter, issueLetter } from "../../../certificates/actions";
import { LetterButton } from "@/components/people/letter-button";
import { ArrangeButton } from "@/components/people/arrange-controls";
import { OneClickAction } from "@/components/people/one-click-action";

export const metadata = { title: "Admitted" };

/**
 * Where an admission ends (the eSkooly comparison's second finding): one
 * screen with everything an office does next, each step saying whether it is
 * done and offering the one action that does it.
 *
 * Nothing here is new authority. Every action is a module's own write, bound
 * to this child, and each step is drawn only for the permission that write
 * needs -- a step the caller cannot take is left out rather than shown
 * refused. Every read is the caller's own, so what a step says is what that
 * module's screen would say.
 */
export default async function AdmittedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [student, ctx, locale, t] = await Promise.all([getStudent(id), getUserContext(), getLocale(), getT()]);
  if (!student) notFound();

  const supabase = await createClient();
  const [
    canIssue,
    canCollect,
    canInvite,
    canAssignBus,
    canAllocateBed,
    canAdmit,
    letter,
    balanceRes,
    busRes,
    bedRes,
    todayRes,
  ] = await Promise.all([
    hasPermission("certificates.issue"),
    hasPermission("fees.collect"),
    hasPermission("users.manage"),
    hasPermission("transport.assign"),
    hasPermission("hostel.allocate"),
    hasPermission("students.manage"),
    findLetter("admission", id),
    supabase.rpc("fees_student_balances", { p_student_ids: [id] }),
    supabase.rpc("transport_for_student", { p_student_id: id }),
    supabase.rpc("hostel_for_student", { p_student_id: id }),
    supabase.rpc("mobile_today"),
  ]);

  const person = student.people;
  const fullName = person ? `${person.first_name} ${person.last_name}`.trim() : t("admitted.theStudent");
  const enrolments = Array.isArray(student.enrolments) ? student.enrolments : [];
  const enrolment = enrolments.find((e) => e.session_id === ctx?.currentSessionId) ?? enrolments[0];
  const classLabel = enrolment?.sections
    ? `${enrolment.sections.class_levels?.name ?? ""} ${enrolment.sections.name}`.trim()
    : null;
  const schoolDay = (todayRes.data as string | null) ?? new Date().toISOString().slice(0, 10);
  const seat = (busRes.data ?? []).find((r) => isCurrentArrangement(r, schoolDay)) ?? null;
  const bed = (bedRes.data ?? []).find((r) => isCurrentArrangement(r, schoolDay)) ?? null;
  const balance = Number(balanceRes.data?.[0]?.balance ?? 0);

  // Whether the family can sign in: `family_login_status` lists the children
  // whose family cannot, with the reason; absent means they can. It refuses a
  // caller without users.manage, who is not shown this step anyway.
  let familyState: string | null = null;
  let familyContact: string | null = null;
  if (canInvite && enrolment?.section_id) {
    const { data } = await supabase.rpc("family_login_status", { p_section_id: enrolment.section_id });
    const row = (data ?? []).find((r) => r.student_id === id);
    familyState = row ? row.state : "can_sign_in";
    familyContact = row?.contact_name ?? null;
  }

  const stepLabels = { done: t("admitted.done"), notDone: t("admitted.notDone"), ifNeeded: t("admitted.ifNeeded") };
  const who = { name: familyContact ?? t("admitted.family.guardian") };
  const family: Record<string, { done: boolean; text: string }> = {
    can_sign_in: { done: true, text: t("admitted.family.can_sign_in") },
    invited: { done: true, text: t("admitted.family.invited", who) },
    not_invited: { done: false, text: t("admitted.family.not_invited", who) },
    expired: { done: false, text: t("admitted.family.expired", who) },
    no_address: { done: false, text: t("admitted.family.no_address", who) },
    no_guardian: { done: false, text: t("admitted.family.no_guardian") },
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-1 size-7 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{t("admitted.title", { name: fullName })}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{student.admission_number}</span>
            {` · ${classLabel ?? t("admitted.noClass")}`}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t("admitted.intro")}</p>

      <ol className="flex flex-col gap-3">
        {canIssue && (
          <Step
            labels={stepLabels}
            icon={<FileText className="size-4" aria-hidden="true" />}
            title={t("admitted.letter.title")}
            done={Boolean(letter)}
            text={letter ? t("admitted.letter.issued", { serial: letter.serialNo }) : t("admitted.letter.none")}
          >
            <LetterButton
              label={letter ? t("admitted.letter.open") : t("admitted.letter.issue")}
              existing={letter}
              issue={issueLetter.bind(null, "admission", id)}
            />
          </Step>
        )}

        {canCollect && (
          <Step
            labels={stepLabels}
            icon={<IndianRupee className="size-4" aria-hidden="true" />}
            title={t("admitted.fee.title")}
            done={balance <= 0}
            text={
              balance > 0
                ? t("admitted.fee.owed", { amount: formatCurrency(balance, locale) })
                : t("admitted.fee.none")
            }
          >
            {balance > 0 && (
              <Button asChild variant="outline">
                <Link href={`/fees/counter?student=${id}`}>{t("admitted.fee.collect")}</Link>
              </Button>
            )}
          </Step>
        )}

        {canInvite && familyState && (
          <Step
            labels={stepLabels}
            icon={<Users className="size-4" aria-hidden="true" />}
            title={t("admitted.family.title")}
            done={family[familyState]?.done ?? false}
            text={family[familyState]?.text ?? familyState}
          >
            {(familyState === "not_invited" || familyState === "expired") && (
              <OneClickAction label={t("admitted.family.invite")} run={inviteFamily.bind(null, id)} />
            )}
            {(familyState === "no_address" || familyState === "no_guardian") && (
              <Button asChild variant="outline">
                <Link href={`/students/${id}#guardians`}>{t("admitted.family.addOnRecord")}</Link>
              </Button>
            )}
          </Step>
        )}

        {canAssignBus && (
          <Step
            labels={stepLabels}
            icon={<Bus className="size-4" aria-hidden="true" />}
            title={t("admitted.bus.title")}
            done={Boolean(seat)}
            optional
            text={seat ? t("admitted.bus.on", { route: seat.route_code, stop: seat.stop_name }) : t("admitted.bus.off")}
          >
            {!seat && (
              <ArrangeButton
                kind="bus"
                label={t("admitted.bus.button")}
                title={t("admitted.bus.dialogTitle", { name: fullName })}
                description={t("admitted.bus.dialogDescription")}
                pickLabel={t("admitted.bus.pick")}
                load={busStopOptions}
                submit={giveBusSeat.bind(null, "student", id)}
                withDirection
              />
            )}
          </Step>
        )}

        {canAllocateBed && (
          <Step
            labels={stepLabels}
            icon={<BedDouble className="size-4" aria-hidden="true" />}
            title={t("admitted.bed.title")}
            done={Boolean(bed)}
            optional
            text={bed ? t("admitted.bed.on", { hostel: bed.hostel_name, room: bed.room_number }) : t("admitted.bed.off")}
          >
            {!bed && (
              <ArrangeButton
                kind="bed"
                label={t("admitted.bed.button")}
                title={t("admitted.bed.dialogTitle", { name: fullName })}
                description={t("admitted.bed.dialogDescription")}
                pickLabel={t("admitted.bed.pick")}
                load={bedOptions}
                submit={giveBed.bind(null, id)}
              />
            )}
          </Step>
        )}

        <Step
          labels={stepLabels}
          icon={<IdCard className="size-4" aria-hidden="true" />}
          title={t("admitted.card.title")}
          done={false}
          optional
          text={t("admitted.card.text")}
        >
          <Button asChild variant="outline">
            <Link href={`/students/${id}/id-card`}>{t("admitted.card.print")}</Link>
          </Button>
        </Step>
      </ol>

      <div className="flex flex-wrap gap-2">
        {canAdmit && (
          <Button asChild>
            <Link href="/students/new">
              <UserPlus className="size-4" aria-hidden="true" />
              {t("admitted.another")}
            </Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={`/students/${id}`}>{t("admitted.openRecord")}</Link>
        </Button>
      </div>
    </div>
  );
}

function Step({
  icon,
  title,
  text,
  done,
  optional = false,
  labels,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  done: boolean;
  optional?: boolean;
  labels: { done: string; notDone: string; ifNeeded: string };
  children?: ReactNode;
}) {
  return (
    <li>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <span className="text-muted-foreground" aria-hidden="true">
            {done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              {icon}
              {title}
              <span className="sr-only">{done ? labels.done : labels.notDone}</span>
              {optional && !done && <span className="text-xs font-normal text-muted-foreground">{labels.ifNeeded}</span>}
            </p>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
          {children && <div className="flex flex-wrap gap-2">{children}</div>}
        </CardContent>
      </Card>
    </li>
  );
}
