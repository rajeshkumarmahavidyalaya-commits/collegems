import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { StaffForm } from "../staff-form";

export const metadata = { title: "Add staff" };

export default async function NewStaffPage() {
  const canManage = await hasPermission("staff.manage");

  // `admins manage staff` is the real gate, and `staff_admit` checks the matrix
  // for the message. This just avoids showing a form whose submit is
  // guaranteed to be rejected.
  if (!canManage) redirect("/staff");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Add staff</h1>
        <p className="text-sm text-muted-foreground">
          Creates the person and their employment record together, in one transaction.
        </p>
      </div>
      <StaffForm />
    </div>
  );
}
