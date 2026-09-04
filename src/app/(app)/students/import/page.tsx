import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../actions";
import { getLiveRun, listPastRuns } from "./actions";
import { ImportView } from "./import-view";

export const metadata = { title: "Import students" };

export default async function ImportPage() {
  const [canView, canPrepare, canApply] = await Promise.all([
    hasPermission("import.view"),
    hasPermission("import.prepare"),
    hasPermission("import.apply"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Import students</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          An import file holds children&apos;s dates of birth before any of them is a student, so it
          is kept to administrators. Ask for <code className="font-mono">import.view</code>.
        </p>
      </div>
    );
  }

  const [{ run, rows, summary }, past, sections] = await Promise.all([
    getLiveRun(),
    listPastRuns(),
    listSections(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Import students</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every real spreadsheet gets three or four rows wrong, and the person who can fix them is
            the one standing here. So this is a preview you can <span className="font-medium">edit</span>
            , and importing writes what the rows say — not what the file said.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/students">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All students
          </Link>
        </Button>
      </div>

      <ImportView
        run={run}
        rows={rows}
        summary={summary}
        past={past}
        sections={sections}
        canPrepare={canPrepare}
        canApply={canApply}
      />
    </div>
  );
}
