import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { StaffInput } from "@/lib/validations/staff";
import { StaffForm } from "../staff-form";

export const metadata = { title: "Add staff" };

const GENDERS = new Set(["male", "female", "other", "undisclosed"]);

export default async function NewStaffPage({ searchParams }: { searchParams: Promise<{ application?: string }> }) {
  const [canManage, { application }] = await Promise.all([hasPermission("staff.manage"), searchParams]);

  // `admins manage staff` is the real gate, and `staff_admit` checks the matrix
  // for the message. This just avoids showing a form whose submit is
  // guaranteed to be rejected.
  if (!canManage) redirect("/staff");

  // Hiring from a public application (0361): the form starts with what the
  // applicant sent, read through the policy, and the office completes the
  // employment half. An id the caller cannot read is simply a blank form.
  let prefill: Partial<StaffInput> | undefined;
  let applicant: string | null = null;
  if (application && /^[0-9a-f-]{36}$/i.test(application)) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("staff_applications")
      .select("first_name, last_name, date_of_birth, gender, email, phone, city, position, status")
      .eq("id", application)
      .maybeSingle();
    if (data && (data.status === "new" || data.status === "shortlisted")) {
      applicant = [data.first_name, data.last_name].filter(Boolean).join(" ");
      prefill = {
        firstName: data.first_name,
        lastName: data.last_name ?? "",
        dateOfBirth: data.date_of_birth ?? "",
        gender: data.gender && GENDERS.has(data.gender) ? (data.gender as StaffInput["gender"]) : undefined,
        email: data.email ?? "",
        phone: data.phone ?? "",
        city: data.city ?? "",
        designation: data.position,
      };
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Add New Staff</h1>
        <p className="text-sm text-muted-foreground">
          Creates the person and their employment record together, in one transaction.
        </p>
        {applicant ? (
          <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            Filled in from {applicant}&apos;s application. Check it, add the employee code and joining date, and the
            application is marked hired when the record is saved.{" "}
            <Link href="/staff/applications?status=shortlisted" className="text-primary underline-offset-4 hover:underline">
              Back to applications
            </Link>
          </p>
        ) : null}
      </div>
      <StaffForm prefill={prefill} applicationId={prefill ? application : undefined} />
    </div>
  );
}
