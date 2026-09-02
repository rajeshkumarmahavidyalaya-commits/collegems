import { getUserContext } from "@/lib/auth/context";
import { getParamOptions, listReports } from "./actions";
import { ReportRunner } from "./report-runner";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const [ctx, reports, options] = await Promise.all([
    getUserContext(),
    listReports(),
    getParamOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every report this school keeps, for {ctx?.currentSessionName ?? "the current session"}.
          Each one reads the same data its own module does, through the same policies — so a
          report cannot show you anything the module would not.
        </p>
      </div>

      <ReportRunner reports={reports} options={options} />
    </div>
  );
}
