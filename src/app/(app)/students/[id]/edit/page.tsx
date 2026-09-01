import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import type { StudentInput } from "@/lib/validations/students";
import { getStudent, listSections } from "../../actions";
import { StudentForm } from "../../student-form";

export const metadata = { title: "Edit student" };

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [student, sections, canManage] = await Promise.all([
    getStudent(id),
    listSections(),
    hasPermission("students.manage"),
  ]);

  if (!student) notFound();
  if (!canManage) redirect(`/students/${id}`);

  const person = student.people;
  const enrolments = Array.isArray(student.enrolments) ? student.enrolments : [];
  const enrolment = enrolments[0];

  // The form works in its own flat shape; map the joined record onto it once
  // here rather than teaching the form about the identity model.
  const defaults: StudentInput & { id: string } = {
    id: student.id,
    firstName: person?.first_name ?? "",
    middleName: person?.middle_name ?? "",
    lastName: person?.last_name ?? "",
    dateOfBirth: person?.date_of_birth ?? "",
    gender: (person?.gender as StudentInput["gender"]) ?? undefined,
    bloodGroup: person?.blood_group ?? "",
    email: person?.email ?? "",
    phone: person?.phone ?? "",
    addressLine1: person?.address_line1 ?? "",
    addressLine2: person?.address_line2 ?? "",
    city: person?.city ?? "",
    state: person?.state ?? "",
    postalCode: person?.postal_code ?? "",
    admissionNumber: student.admission_number,
    admissionDate: student.admission_date,
    status: student.status as StudentInput["status"],
    sectionId: enrolment?.section_id ?? "",
    rollNumber: enrolment?.roll_number ?? "",
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Edit student</h1>
        <p className="text-sm text-muted-foreground">
          {person ? `${person.first_name} ${person.last_name}` : student.admission_number}
        </p>
      </div>
      <StudentForm sections={sections} student={defaults} />
    </div>
  );
}
