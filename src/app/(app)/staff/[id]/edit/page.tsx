import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { getStaffRecord } from "../../actions";
import { StaffForm } from "../../staff-form";

export const metadata = { title: "Edit staff record" };

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [record, canManage] = await Promise.all([
    getStaffRecord(id),
    hasPermission("staff.manage"),
  ]);

  if (!canManage) redirect(`/staff/${id}`);
  if (!record) notFound();

  const { staff, person } = record;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Edit {person.full_name}</h1>
        <p className="text-sm text-muted-foreground">
          Corrections to who they are and what they do. Recording that they have left is a
          different act, on their record page.
        </p>
      </div>
      <StaffForm
        staff={{
          id: staff.id,
          firstName: person.first_name,
          middleName: person.middle_name ?? "",
          lastName: person.last_name,
          dateOfBirth: person.date_of_birth ?? "",
          gender: (person.gender as "male" | "female" | "other" | "undisclosed") || undefined,
          bloodGroup: person.blood_group ?? "",
          email: person.email ?? "",
          phone: person.phone ?? "",
          addressLine1: person.address_line1 ?? "",
          addressLine2: person.address_line2 ?? "",
          city: person.city ?? "",
          state: person.state ?? "",
          postalCode: person.postal_code ?? "",
          employeeCode: staff.employee_code,
          designation: staff.designation,
          department: staff.department ?? "",
          dateOfJoining: staff.date_of_joining,
        }}
      />
    </div>
  );
}
