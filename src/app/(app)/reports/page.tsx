import { getUserContext } from "@/lib/auth/context";
import { getParamOptions, listReports } from "./actions";
import { ReportRunner } from "./report-runner";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const { report } = await searchParams;
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

      {/* A module links straight to its own report with ?report=<key>; an
          unknown or withheld key falls back to the first, as before. */}
      <ReportRunner reports={reports} options={options} initialKey={report} />
    </div>
  );
}
