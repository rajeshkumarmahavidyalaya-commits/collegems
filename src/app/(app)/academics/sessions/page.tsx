import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listAcademicYears } from "./actions";
import { AcademicYears } from "./academic-years";

export const metadata = { title: "Academic years" };

/**
 * The academic years, and which one the school is working in.
 *
 * This screen exists because `current_session_id()` reads a flag that nothing
 * in the application could move. Measured on the demo school before it was
 * built: 6,000 of 6,000 register rows, 323 of 323 ledger entries and 317 of 317
 * invoices were dated after the year they were stamped with had ended, because
 * every row is dated today and filed under whichever year holds the flag.
 */
export default async function AcademicYearsPage() {
  const [ctx, years, canManage] = await Promise.all([
    getUserContext(),
    listAcademicYears(),
    hasPermission("academics.manage"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Academic years</h1>
        <p className="text-sm text-muted-foreground">
          {ctx?.tenantName ?? "This school"} files every register, invoice and receipt under the
          year that is current when it is written. Making the right one current is how those rows
          land in the right year.
        </p>
      </div>

      <AcademicYears years={years} canManage={canManage} />
    </div>
  );
}
