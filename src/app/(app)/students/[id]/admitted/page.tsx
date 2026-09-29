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
import { getLocale } from "@/lib/i18n/server";
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
  const [student, ctx, locale] = await Promise.all([getStudent(id), getUserContext(), getLocale()]);
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
  const fullName = person ? `${person.first_name} ${person.last_name}`.trim() : "The student";
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

  const family: Record<string, { done: boolean; text: string }> = {
    can_sign_in: { done: true, text: "The family can sign in." },
    invited: { done: true, text: `${familyContact ?? "The guardian"} has been invited and has not signed up yet.` },
    not_invited: { done: false, text: `${familyContact ?? "The guardian"} has an email address and has not been invited.` },
    expired: { done: false, text: `The invitation to ${familyContact ?? "the guardian"} expired unused.` },
    no_address: { done: false, text: `${familyContact ?? "The guardian"} has no email address, so there is nowhere to send an invitation.` },
    no_guardian: { done: false, text: "No guardian is on record yet." },
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-1 size-7 shrink-0 text-success" aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{fullName} is admitted</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{student.admission_number}</span>
            {classLabel ? ` · ${classLabel}` : " · no class yet"}
          </p>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        What the office usually does next. Each step says whether it is done; none of them is
        required, and all of them are on the student&apos;s record later.
      </p>

      <ol className="flex flex-col gap-3">
        {canIssue && (
          <Step
            icon={<FileText className="size-4" aria-hidden="true" />}
            title="Admission letter"
            done={Boolean(letter)}
            text={letter ? `Letter ${letter.serialNo} is issued.` : "A numbered letter for the family to keep."}
          >
            <LetterButton
              label={letter ? "Open letter" : "Issue and print"}
              existing={letter}
              issue={issueLetter.bind(null, "admission", id)}
            />
          </Step>
        )}

        {canCollect && (
          <Step
            icon={<IndianRupee className="size-4" aria-hidden="true" />}
            title="First fee"
            done={balance <= 0}
            text={
              balance > 0
                ? `${formatCurrency(balance, locale)} is owed on this child's account.`
                : "Nothing is owed on this child's account yet."
            }
          >
            {balance > 0 && (
              <Button asChild variant="outline">
                <Link href={`/fees/counter?student=${id}`}>Collect fee</Link>
              </Button>
            )}
          </Step>
        )}

        {canInvite && familyState && (
          <Step
            icon={<Users className="size-4" aria-hidden="true" />}
            title="Family login"
            done={family[familyState]?.done ?? false}
            text={family[familyState]?.text ?? familyState}
          >
            {(familyState === "not_invited" || familyState === "expired") && (
              <OneClickAction label="Invite the family" run={inviteFamily.bind(null, id)} />
            )}
            {(familyState === "no_address" || familyState === "no_guardian") && (
              <Button asChild variant="outline">
                <Link href={`/students/${id}#guardians`}>Add on the record</Link>
              </Button>
            )}
          </Step>
        )}

        {canAssignBus && (
          <Step
            icon={<Bus className="size-4" aria-hidden="true" />}
            title="School bus"
            done={Boolean(seat)}
            optional
            text={seat ? `Route ${seat.route_code}, ${seat.stop_name}.` : "Not on a school bus."}
          >
            {!seat && (
              <ArrangeButton
                kind="bus"
                label="Put on a bus"
                title={`A bus seat for ${fullName}`}
                description="The fare comes from the stop and joins the next invoice. A full bus is refused."
                pickLabel="Stop"
                load={busStopOptions}
                submit={giveBusSeat.bind(null, "student", id)}
                withDirection
              />
            )}
          </Step>
        )}

        {canAllocateBed && (
          <Step
            icon={<BedDouble className="size-4" aria-hidden="true" />}
            title="Hostel"
            done={Boolean(bed)}
            optional
            text={bed ? `${bed.hostel_name}, room ${bed.room_number}.` : "A day scholar: no hostel bed."}
          >
            {!bed && (
              <ArrangeButton
                kind="bed"
                label="Give a bed"
                title={`A hostel bed for ${fullName}`}
                description="The room's fare joins the next invoice. A full room, or a house that does not take this child, is refused."
                pickLabel="Room"
                load={bedOptions}
                submit={giveBed.bind(null, id)}
              />
            )}
          </Step>
        )}

        <Step
          icon={<IdCard className="size-4" aria-hidden="true" />}
          title="Identity card"
          done={false}
          optional
          text="Printed from the record, with the photograph if one has been added."
        >
          <Button asChild variant="outline">
            <Link href={`/students/${id}/id-card`}>Print ID card</Link>
          </Button>
        </Step>
      </ol>

      <div className="flex flex-wrap gap-2">
        {canAdmit && (
          <Button asChild>
            <Link href="/students/new">
              <UserPlus className="size-4" aria-hidden="true" />
              Admit another student
            </Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={`/students/${id}`}>Open the record</Link>
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
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  done: boolean;
  optional?: boolean;
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
              <span className="sr-only">{done ? "(done)" : "(not done)"}</span>
              {optional && !done && <span className="text-xs font-normal text-muted-foreground">if needed</span>}
            </p>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
          {children && <div className="flex flex-wrap gap-2">{children}</div>}
        </CardContent>
      </Card>
    </li>
  );
}
