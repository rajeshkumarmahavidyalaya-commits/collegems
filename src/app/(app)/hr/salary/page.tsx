import { hasPermission } from "@/lib/auth/permissions";
import { listAssignments, listStaffOptions, listStructures } from "../actions";
import { SalaryAdmin } from "./salary-admin";

export const metadata = { title: "Salary structures" };

export default async function SalaryPage() {
  const [structures, assignments, staff, canManage] = await Promise.all([
    listStructures(),
    listAssignments(),
    listStaffOptions(),
    hasPermission("hr.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Salary structures</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          What a salary is made of is a document, not a branch in the code. Basic, allowances,
          provident fund, professional tax — every one of those differs between two schools on the
          same street, and hardcoding the first customer&apos;s version is how a product fails its
          second.
        </p>
      </div>

      <SalaryAdmin
        structures={structures}
        assignments={assignments}
        staff={staff}
        canManage={canManage}
      />
    </div>
  );
}
