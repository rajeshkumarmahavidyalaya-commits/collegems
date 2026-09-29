import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Bus, CalendarClock, IdCard, Pencil } from "lucide-react";
import { currentStaffSeat } from "../../transport/actions";
import { ArrangeButton, LibraryCardButton } from "@/components/people/arrange-controls";
import { busStopOptions, giveBusSeat, giveLibraryCard } from "../../students/arrangement-actions";
import { formatStopTime } from "@/lib/validations/transport-display";
import { PhotoControl } from "@/components/people/photo-control";
import { removeStaffPhoto, setStaffPhoto, staffPhotoUrl } from "../photo-actions";
import { BUCKET_LIMITS, formatBytes } from "@/lib/storage/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { hasPermission } from "@/lib/auth/permissions";
import { staffStatusLabel, staffStatusTone } from "@/lib/validations/staff-display";
import { deleteStaffRecord, getStaffRecord } from "../actions";
import { DeleteRecordControl } from "@/components/people/delete-record-control";
import { StaffExitControl } from "./staff-exit-control";
import { GiveLoginControl } from "./give-login-control";
import { listRoles } from "../../settings/team/actions";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { LetterButton } from "@/components/people/letter-button";
import { findLetter, issueLetter } from "../../certificates/actions";

export const metadata = { title: "Staff record" };

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const [record, canManage, canManageLogins] = await Promise.all([
    getStaffRecord(id),
    hasPermission("staff.manage"),
    hasPermission("users.manage"),
  ]);

  // `staff_record` raises for a caller without `staff.view` and for an id they
  // cannot see, and both arrive here as null. That is deliberate: which of the
  // two it was is not something to tell somebody who may not look.
  if (!record) notFound();

  const { staff, person, teaching, library } = record;
  // Signed only after `staff_record` has already refused a caller without
  // `staff.view` — rule 8 again, and the reason this is not read alongside the
  // record: `staff_record` does not project `photo_path`, so it is a column it
  // does not return rather than a second answer to a question it answers.
  const [photo, canAssignSeat, canSeeTransport, canGiveCard, canIssueLetter, letter] = await Promise.all([
    staffPhotoUrl(staff.id),
    hasPermission("transport.assign"),
    hasPermission("transport.view"),
    hasPermission("library.manage"),
    hasPermission("certificates.issue"),
    // The appointment letter (0300), if one is live.
    findLetter("appointment", staff.id),
  ]);
  // The seat through `transport_for_staff` (0293), an invoker read: the
  // assignment policies decide, so a caller who may not see it gets nothing.
  const seat = canSeeTransport ? await currentStaffSeat(staff.id) : null;
  const avatarLimits = BUCKET_LIMITS["avatars"];
  const hasLeft = staff.status !== "active";
  const address = [person.address_line1, person.address_line2].filter(Boolean).join(", ");

  // Whether to offer "Give a login": only to somebody who manages logins,
  // for a current member of staff who has neither a login nor a pending
  // invitation. Both reads go through the admin policies, which is also why
  // they are only asked of somebody holding users.manage (0289).
  let loginRoles: { id: string; name: string; code: string }[] = [];
  if (canManageLogins && !hasLeft) {
    const supabase = await createClient();
    const [{ count: logins }, { count: pending }, roles] = await Promise.all([
      supabase.from("user_profiles").select("id", { count: "exact", head: true }).eq("staff_id", staff.id),
      supabase
        .from("invitations")
        .select("id", { count: "exact", head: true })
        .eq("staff_id", staff.id)
        .eq("status", "pending"),
      listRoles(),
    ]);
    if (!logins && !pending) loginRoles = roles.filter((r) => r.subject === "staff");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold break-words">{person.full_name}</h1>
            <Badge variant={staffStatusTone(staff.status)}>{staffStatusLabel(staff.status, t)}</Badge>
            {record.away_today && !hasLeft && <Badge variant="warning">Away today</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{staff.employee_code}</span> · {staff.designation}
            {staff.department ? ` · ${staff.department}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Not behind `canManage`: this page already required `staff.view`
              (staff_record raises without it), and printing a badge is not an
              edit. A leaver gets no card — theirs is a door that should not
              open, which is student_exit's lesson pointed at a badge. */}
          {!hasLeft && (
            <Button asChild variant="outline">
              <Link href={`/staff/${staff.id}/id-card`}>
                <IdCard className="size-4" aria-hidden="true" />
                {t("idCard.printOne")}
              </Link>
            </Button>
          )}
          {canIssueLetter && (!hasLeft || letter) && (
            <LetterButton
              label="Appointment letter"
              existing={letter}
              issue={issueLetter.bind(null, "appointment", staff.id)}
            />
          )}
          {canManage && (
            <>
            <Button asChild variant="outline">
              <Link href={`/staff/${staff.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            {loginRoles.length > 0 && (
              <GiveLoginControl
                staffId={staff.id}
                name={person.full_name}
                email={person.email}
                roles={loginRoles}
              />
            )}
            {!hasLeft && <StaffExitControl staffId={staff.id} staffName={person.full_name} />}
            <DeleteRecordControl
              name={person.full_name}
              kind="staff"
              action={deleteStaffRecord.bind(null, staff.id)}
              afterDelete="/staff"
            />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <PhotoControl
              ownerId={staff.id}
              photoUrl={photo}
              canManage={canManage}
              onUpload={setStaffPhoto}
              onRemove={removeStaffPhoto}
              // Eight resolved strings rather than the whole catalogue: this
              // route has no other client-side i18n consumer, and the students
              // page measured that at +22 kB against +1 kB for props.
              labels={{
                heading: t("idCard.photo.heading"),
                choose: t("idCard.photo.choose"),
                replace: t("idCard.photo.replace"),
                remove: t("idCard.photo.remove"),
                none: t("idCard.photo.none"),
                limit: t("idCard.photo.limit", { size: formatBytes(avatarLimits.maxBytes) }),
                uploaded: t("idCard.photo.uploaded"),
                removed: t("idCard.photo.removed"),
              }}
            />
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Date of birth" value={person.date_of_birth} />
              <Fact
                label="Gender"
                value={person.gender ? <span className="capitalize">{person.gender}</span> : null}
              />
              <Fact label="Blood group" value={person.blood_group} />
              <Fact label="Phone" value={person.phone} />
              <Fact label="Email" value={person.email} />
              <Fact label="Joined" value={staff.date_of_joining} />
            </dl>
            <Separator className="my-4" />
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Address" value={address || null} />
              <Fact label="City" value={person.city} />
              <Fact label="State" value={person.state} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
            <CardDescription>
              {hasLeft
                ? `Left on ${staff.date_of_leaving ?? "an unrecorded date"}.`
                : "Currently on the staff."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Fact label="Designation" value={staff.designation} />
              <Fact label="Department" value={staff.department} />
              <Fact label="Joined" value={staff.date_of_joining} />
              <Fact label="Left" value={staff.date_of_leaving} />
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
              What they are responsible for
            </CardTitle>
            <CardDescription>
              {hasLeft
                ? "Zeroes here are the exit having worked: leaving unassigns all three."
                : "This academic session."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-4">
              <Fact
                label="Lessons a week"
                value={<span className="text-lg tabular-nums">{teaching.lessons}</span>}
              />
              <Fact
                label="Subject assignments"
                value={<span className="text-lg tabular-nums">{teaching.subjects}</span>}
              />
              <Fact
                label="Class teacher of"
                value={
                  <span className="text-lg tabular-nums">{teaching.class_teacher_of.length}</span>
                }
              />
            </dl>
            {teaching.class_teacher_of.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {teaching.class_teacher_of.map((s) => (
                  <Badge key={s.id} variant="secondary">
                    {s.label}
                  </Badge>
                ))}
              </div>
            )}
            {teaching.lessons > 0 && (
              <p className="text-sm text-muted-foreground">
                <Link href="/timetable" className="underline underline-offset-4">
                  Open the timetable
                </Link>{" "}
                to see or change them.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
              Library
            </CardTitle>
          </CardHeader>
          <CardContent>
            {library ? (
              <dl className="grid grid-cols-2 gap-4">
                <Fact
                  label="Card"
                  value={<span className="font-mono text-xs">{library.membership_number}</span>}
                />
                <Fact
                  label="Status"
                  value={<span className="capitalize">{library.status}</span>}
                />
                <Fact
                  label="Books out"
                  value={<span className="tabular-nums">{library.books_out}</span>}
                />
              </dl>
            ) : canGiveCard && !hasLeft ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">No library card yet.</p>
                <LibraryCardButton give={giveLibraryCard.bind(null, "staff", staff.id)} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No library card. One can be issued from the library members screen.
              </p>
            )}
            {library && library.books_out > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                A fine on a member of staff is a payroll deduction rather than a fee receivable —
                the ledger only takes a student.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Drawn only for somebody who may see seats: "no seat" to a caller
            who cannot read them would be the policy speaking, not a fact. */}
        {canSeeTransport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bus className="size-4 text-muted-foreground" aria-hidden="true" />
              Transport
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {seat ? (
              <dl className="grid grid-cols-2 gap-4">
                <Fact label="Route" value={<span className="font-mono">{seat.routeCode}</span>} />
                <Fact label="Stop" value={seat.stopName} />
                <Fact label="Pickup" value={formatStopTime(seat.pickupTime)} />
                <Fact label="Vehicle" value={seat.vehicle} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No seat on a school bus.</p>
            )}
            {canAssignSeat && !hasLeft && !seat && (
              <ArrangeButton
                kind="bus"
                label="Give a seat"
                title={`A bus seat for ${person.full_name}`}
                description="Same buses and the same seat count as the children. A staff seat is free."
                pickLabel="Stop"
                load={busStopOptions}
                submit={giveBusSeat.bind(null, "staff", staff.id)}
                withDirection
              />
            )}
            {canAssignSeat && seat && (
              <Link href="/transport/assignments" className="text-sm underline underline-offset-4">
                Change or end on the transport screen
              </Link>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
