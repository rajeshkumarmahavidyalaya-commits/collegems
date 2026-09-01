import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "./actions";
import { StudentsTable } from "./students-table";

export const metadata = { title: "Students" };

export default async function StudentsPage() {
  const [ctx, sections, canManage] = await Promise.all([
    getUserContext(),
    listSections(),
    hasPermission("students.manage"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Students</h1>
          <p className="text-sm text-muted-foreground">
            The register for {ctx?.currentSessionName ?? "the current session"} at{" "}
            {ctx?.tenantName ?? "this school"}.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/students/new">
              <UserPlus className="size-4" aria-hidden="true" />
              Admit student
            </Link>
          </Button>
        )}
      </div>

      <StudentsTable sections={sections} canManage={canManage} />
    </div>
  );
}
