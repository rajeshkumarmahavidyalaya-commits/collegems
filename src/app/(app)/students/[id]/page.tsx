import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, IdCard, Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { hasPermission } from "@/lib/auth/permissions";
import { getStudent } from "../actions";
import { ExitControl } from "./exit-control";
import { GuardiansCard, type GuardianRow } from "./guardians-card";
import { relationshipLabel, relationshipOptions } from "@/lib/validations/guardians";
import { PhotoControl } from "@/components/people/photo-control";
import { removeStudentPhoto, setStudentPhoto } from "../photo-actions";
import { photoUrl } from "@/lib/storage/photos";
import { getT } from "@/lib/i18n/server";
import { BUCKET_LIMITS, formatBytes } from "@/lib/storage/constants";
import { getUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { StudentTypeControl } from "./student-type-control";
import { SubjectsView } from "@/components/electives/subjects-view";
import { getSubjectsFor } from "../../my-subjects/actions";
import { saveChoiceFor } from "../../academics/electives/actions";
import { getLocale } from "@/lib/i18n/server";

export const metadata = { title: "Student" };

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [student, canManage, canManageGuardians, canSetType, t, ctx, subjects, canChooseFor, locale] = await Promise.all([
    getStudent(id),
    hasPermission("students.manage"),
    hasPermission("guardians.manage"),
    // Held by exactly the roles the student_type_assignments policy lets write.
    hasPermission("fees.collect"),
    getT(),
    getUserContext(),
    // Read through RLS, like the record itself; a child the caller cannot see
    // comes back not enrolled and draws nothing.
    getSubjectsFor(id),
    // The gate the electives screen uses; `subject_choice_save` is the boundary.
    hasPermission("academics.manage"),
    getLocale(),
  ]);

  if (!student) notFound();

  const person = student.people;
  const enrolments = Array.isArray(student.enrolments) ? student.enrolments : [];
  // This year's, not the first the join returns: once a child has been
  // promoted they hold one enrolment per year, and the card says "current".
  const enrolment =
    enrolments.find((e) => e.session_id === ctx?.currentSessionId) ??
    (ctx?.currentSessionId ? undefined : enrolments[0]);

  // What kind of student they are this year (0281). Finance roles only, by
  // policy; for anybody else both reads come back empty and nothing is drawn.
  let studentTypes: { id: string; name: string; isActive: boolean }[] = [];
  let studentTypeId: string | null = null;
  if (canSetType && enrolment && ctx?.currentSessionId) {
    const supabase = await createClient();
    const [typesRes, assignedRes] = await Promise.all([
      supabase.from("student_types").select("id, name, is_active").order("name"),
      supabase
        .from("student_type_assignments")
        .select("student_type_id")
        .eq("student_id", id)
        .eq("session_id", ctx.currentSessionId)
        .maybeSingle(),
    ]);
    studentTypes = (typesRes.data ?? []).map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
    studentTypeId = assignedRes.data?.student_type_id ?? null;
  }
  const guardianLinks = Array.isArray(student.guardian_student) ? student.guardian_student : [];
  // Flattened here rather than in the client component: the card is a
  // `"use client"` module, so everything it receives crosses the boundary as
  // JSON anyway, and shaping it on the server keeps the nested select's shape
  // out of the bundle.
  const guardians: GuardianRow[] = guardianLinks.map((link) => {
    const gp = link.guardians?.people;
    return {
      guardianId: link.guardian_id,
      fullName: gp ? `${gp.first_name} ${gp.last_name ?? ""}`.trim() : "—",
      relationship: link.relationship,
      relationshipName: relationshipLabel(link.relationship, t),
      isPrimary: link.is_primary,
      canPickup: link.can_pickup,
      phone: gp?.phone ?? null,
      email: gp?.email ?? null,
      occupation: link.guardians?.occupation ?? null,
      firstName: gp?.first_name ?? "",
      middleName: gp?.middle_name ?? null,
      lastName: gp?.last_name ?? null,
      addressLine1: gp?.address_line1 ?? null,
      city: gp?.city ?? null,
      state: gp?.state ?? null,
    };
  });
  const memberships = Array.isArray(student.members) ? student.members : [];
  const membership = memberships[0];
  const issues = Array.isArray(membership?.book_issues) ? membership.book_issues : [];
  const openIssues = issues.filter((i) => i.status === "issued");
  const today = new Date().toISOString().slice(0, 10);

  const fullName = person ? `${person.first_name} ${person.last_name}` : "Unknown student";
  // Signed here rather than in `getStudent`, and only once the row is in hand:
  // rule 8 makes the signature the authorization, so a URL is never issued for
  // a path the policy did not just hand back.
  const photo = await photoUrl(person?.photo_path);
  const AVATAR_LIMITS = BUCKET_LIMITS["avatars"];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold break-words">{fullName}</h1>
            <Badge variant={student.status === "active" ? "success" : "secondary"} className="capitalize">
              {student.status}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{student.admission_number}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Not behind `canManage`: printing a card shows what the roll already
              shows, and the office is not always the one printing it. */}
          <Button asChild variant="outline">
            <Link href={`/students/${student.id}/id-card`}>
              <IdCard className="size-4" aria-hidden="true" />
              {t("idCard.printOne")}
            </Link>
          </Button>
          {canManage && (
            <>
            <Button asChild variant="outline">
              <Link href={`/students/${student.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            {student.status === "active" && (
              <ExitControl studentId={student.id} studentName={fullName} />
            )}
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
              ownerId={student.id}
              onUpload={setStudentPhoto}
              onRemove={removeStudentPhoto}
              photoUrl={photo}
              canManage={canManage}
              // Seven resolved strings rather than the whole catalogue: this
              // route had no client-side i18n consumer, and adding one cost it
              // 22 kB. See the note in `photo-control.tsx`.
              labels={{
                heading: t("idCard.photo.heading"),
                choose: t("idCard.photo.choose"),
                replace: t("idCard.photo.replace"),
                remove: t("idCard.photo.remove"),
                none: t("idCard.photo.none"),
                limit: t("idCard.photo.limit", { size: formatBytes(AVATAR_LIMITS.maxBytes) }),
                uploaded: t("idCard.photo.uploaded"),
                removed: t("idCard.photo.removed"),
              }}
            />
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact label="Date of birth" value={person?.date_of_birth} />
              <Fact
                label="Gender"
                value={person?.gender ? <span className="capitalize">{person.gender}</span> : null}
              />
              <Fact label="Blood group" value={person?.blood_group} />
              <Fact label="Phone" value={person?.phone} />
              <Fact label="Email" value={person?.email} />
              <Fact label="Admitted" value={student.admission_date} />
            </dl>
            <Separator className="my-4" />
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fact
                label="Address"
                value={
                  person?.address_line1
                    ? [person.address_line1, person.address_line2].filter(Boolean).join(", ")
                    : null
                }
              />
              <Fact label="City" value={person?.city} />
              <Fact label="State" value={person?.state} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enrolment</CardTitle>
            <CardDescription>Current academic session</CardDescription>
          </CardHeader>
          <CardContent>
            {enrolment?.sections ? (
              <dl className="grid gap-4">
                <Fact
                  label="Class · section"
                  value={
                    enrolment.sections.class_levels
                      ? `${enrolment.sections.class_levels.name} · ${enrolment.sections.name}`
                      : enrolment.sections.name
                  }
                />
                <Fact label="Roll number" value={enrolment.roll_number} />
                <Fact
                  label="Status"
                  value={<span className="capitalize">{enrolment.status}</span>}
                />
                {canSetType && studentTypes.length > 0 && (
                  <Fact
                    label="Kind of student (sets which fees apply)"
                    value={
                      <StudentTypeControl
                        studentId={student.id}
                        studentName={fullName}
                        current={studentTypeId}
                        types={studentTypes}
                        sessionName={ctx?.currentSessionName ?? "this year"}
                      />
                    }
                  />
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not enrolled in a class for {ctx?.currentSessionName ?? "this session"} yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {subjects.enrolled && (subjects.groups.length > 0 || subjects.compulsory.length > 0) && (
        <section className="flex flex-col gap-3" aria-labelledby="student-subjects">
          <h2 id="student-subjects" className="text-lg font-semibold">
            Subjects this year
          </h2>
          <SubjectsView
            mine={subjects}
            locale={locale}
            mode={canChooseFor ? "office" : "readonly"}
            save={canChooseFor ? saveChoiceFor.bind(null, student.id) : undefined}
          />
        </section>
      )}

      <GuardiansCard
        studentId={student.id}
        studentName={fullName}
        guardians={guardians}
        relationships={relationshipOptions(t)}
        canManage={canManageGuardians}
      />

      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
          <CardDescription>
            {membership
              ? `Membership ${membership.membership_number}`
              : "This student has no library membership"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!membership ? (
            <p className="text-sm text-muted-foreground">
              Create one from{" "}
              <Link href="/library/members" className="underline underline-offset-4">
                Library → Members
              </Link>{" "}
              to let this student borrow books.
            </p>
          ) : openIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No books currently on loan.</p>
          ) : (
            <ul className="grid gap-2">
              {openIssues.map((issue) => {
                const overdue = issue.due_at < today;
                return (
                  <li
                    key={issue.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="break-words">{issue.books?.title ?? "—"}</span>
                    </span>
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Due {issue.due_at}</span>
                      {overdue && (
                        <Badge variant="warning">
                          <TriangleAlert className="size-3" aria-hidden="true" />
                          Overdue
                        </Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
