import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listExams, listSchemes } from "./actions";
import { listExamGroups } from "./group-actions";
import Link from "next/link";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExamsList } from "./exams-list";
import { ModuleCards } from "@/components/module-cards";

export const metadata = { title: "Exams" };

export default async function ExamsPage() {
  const [ctx, exams, schemes, groups, canManage] = await Promise.all([
    getUserContext(),
    listExams(),
    listSchemes(),
    listExamGroups(),
    hasPermission("exams.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Manage Exams</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Examinations for {ctx?.currentSessionName ?? "the current session"}.
            How marks become a result — grade bands, grace, best-of-N,
            additional subjects — is a grading scheme, stored as data, so a
            school with different rules is a row rather than a release.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/exams/groups">
            <Layers className="size-4" aria-hidden="true" />
            Exam Groups
          </Link>
        </Button>
      </div>
      <ModuleCards module="exams" />

      <ExamsList
        exams={exams}
        schemes={schemes}
        groups={groups}
        canManage={canManage}
      />
    </div>
  );
}
