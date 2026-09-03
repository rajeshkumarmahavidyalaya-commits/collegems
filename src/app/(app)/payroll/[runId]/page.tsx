import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { formatMonth, runStatusLabel } from "@/lib/validations/hr";
import { getPayslipLines, getRegister, getRun } from "../actions";
import { RunRegister } from "./run-register";

export const metadata = { title: "Payroll run" };

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  const [run, rows, canProcess] = await Promise.all([
    getRun(runId),
    getRegister(runId),
    hasPermission("payroll.process"),
  ]);

  if (!run) notFound();

  const lines = await getPayslipLines(rows.map((r) => r.payslipId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href="/payroll">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All runs
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{formatMonth(run.periodMonth)}</h1>
          <Badge variant={run.status === "finalised" ? "default" : "secondary"}>
            {runStatusLabel(run.status)}
          </Badge>
        </div>
        {run.note && <p className="text-sm text-muted-foreground">{run.note}</p>}
      </div>

      <RunRegister run={run} rows={rows} lines={lines} canProcess={canProcess} />
    </div>
  );
}
