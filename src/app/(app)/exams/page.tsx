import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listExams, listSchemes } from "./actions";
import { ExamsList } from "./exams-list";

export const metadata = { title: "Exams" };

export default async function ExamsPage() {
  const [ctx, exams, schemes, canManage] = await Promise.all([
    getUserContext(),
    listExams(),
    listSchemes(),
    hasPermission("settings.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Exams</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Examinations for {ctx?.currentSessionName ?? "the current session"}. How marks become a
          result — grade bands, grace, best-of-N, additional subjects — is a grading scheme, stored
          as data, so a school with different rules is a row rather than a release.
        </p>
      </div>

      <ExamsList exams={exams} schemes={schemes} canManage={canManage} />
    </div>
  );
}
