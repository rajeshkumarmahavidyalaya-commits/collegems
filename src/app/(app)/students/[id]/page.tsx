import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { hasPermission } from "@/lib/auth/permissions";
import { getStudent } from "../actions";

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
  const [student, canManage] = await Promise.all([getStudent(id), hasPermission("students.manage")]);

  if (!student) notFound();

  const person = student.people;
  const enrolments = Array.isArray(student.enrolments) ? student.enrolments : [];
  const enrolment = enrolments[0];
  const guardianLinks = Array.isArray(student.guardian_student) ? student.guardian_student : [];
  const memberships = Array.isArray(student.members) ? student.members : [];
  const membership = memberships[0];
  const issues = Array.isArray(membership?.book_issues) ? membership.book_issues : [];
  const openIssues = issues.filter((i) => i.status === "issued");
  const today = new Date().toISOString().slice(0, 10);

  const fullName = person ? `${person.first_name} ${person.last_name}` : "Unknown student";

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
        {canManage && (
          <Button asChild variant="outline">
            <Link href={`/students/${student.id}/edit`}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent>
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
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not enrolled in a section for this session yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Guardians</CardTitle>
          <CardDescription>Who to contact, and who may collect this student</CardDescription>
        </CardHeader>
        <CardContent>
          {guardianLinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guardians linked to this student yet.</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {guardianLinks.map((link, i) => {
                const gp = link.guardians?.people;
                return (
                  <li key={i} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-words">
                        {gp ? `${gp.first_name} ${gp.last_name}` : "—"}
                      </span>
                      <Badge variant="secondary" className="capitalize">
                        {link.relationship}
                      </Badge>
                      {link.is_primary && <Badge variant="outline">Primary contact</Badge>}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-3">
                      <Fact label="Phone" value={gp?.phone} />
                      <Fact label="Occupation" value={link.guardians?.occupation} />
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

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
