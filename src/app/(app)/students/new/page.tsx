import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../actions";
import { StudentForm } from "../student-form";

export const metadata = { title: "Admit student" };

export default async function NewStudentPage() {
  const [sections, canManage] = await Promise.all([listSections(), hasPermission("students.manage")]);

  // The RLS policy is the real gate; this just avoids showing a form whose
  // submit is guaranteed to be rejected.
  if (!canManage) redirect("/students");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Admit student</h1>
        <p className="text-sm text-muted-foreground">
          Creates the person, their student record, and their enrolment together.
        </p>
      </div>
      <StudentForm sections={sections} />
    </div>
  );
}
