import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, CalendarClock, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { hasPermission } from "@/lib/auth/permissions";
import { staffStatusLabel, staffStatusTone } from "@/lib/validations/staff-display";
import { getStaffRecord } from "../actions";
import { StaffExitControl } from "./staff-exit-control";

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
  const { id } = await params;
  const [record, canManage] = await Promise.all([
    getStaffRecord(id),
    hasPermission("staff.manage"),
  ]);

  // `staff_record` raises for a caller without `staff.view` and for an id they
  // cannot see, and both arrive here as null. That is deliberate: which of the
  // two it was is not something to tell somebody who may not look.
  if (!record) notFound();

  const { staff, person, teaching, library } = record;
  const hasLeft = staff.status !== "active";
  const address = [person.address_line1, person.address_line2].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold break-words">{person.full_name}</h1>
            <Badge variant={staffStatusTone(staff.status)}>{staffStatusLabel(staff.status)}</Badge>
            {record.away_today && !hasLeft && <Badge variant="warning">Away today</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{staff.employee_code}</span> · {staff.designation}
            {staff.department ? ` · ${staff.department}` : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/staff/${staff.id}/edit`}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            {!hasLeft && <StaffExitControl staffId={staff.id} staffName={person.full_name} />}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent>
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
      </div>
    </div>
  );
}
