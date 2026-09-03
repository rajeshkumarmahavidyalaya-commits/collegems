import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { getMyPayslips, listRuns } from "./actions";
import { MyPayslips, PayrollRuns } from "./payroll-runs";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const [ctx, canView, canProcess] = await Promise.all([
    getUserContext(),
    hasPermission("payroll.view"),
    hasPermission("payroll.process"),
  ]);

  // Same shape as `/homework`: one address, two screens. Somebody without the
  // payroll permission gets their own payslips, which is what the
  // row-ownership policy on `payslips` allows them anyway.
  if (!canView) {
    const payslips = await getMyPayslips();
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">My pay</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What you were paid, month by month. If a figure looks wrong, the office holds the
            register and the salary structure it was computed from.
          </p>
        </div>
        <MyPayslips payslips={payslips} />
      </div>
    );
  }

  const runs = await listRuns();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Salaries for {ctx?.currentSessionName ?? "the current session"}. What a salary is made of
          is a structure stored as data, so a school with different components is a row rather than
          a release.
        </p>
      </div>

      <PayrollRuns runs={runs} canProcess={canProcess} />
    </div>
  );
}
