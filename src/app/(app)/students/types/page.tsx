import Link from "next/link";
import { IndianRupee, Tags, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { STUDENT_TYPE_WRITERS } from "@/lib/validations/student-types";
import { listSections } from "../actions";
import { StudentTypesPanel } from "../../fees/setup/student-types-panel";
import { listStudentTypes, listTypedStudents } from "../../fees/setup/student-type-actions";

export const metadata = { title: "Student Types" };

/**
 * Manage Student type, in SM Student (0328). The same panel as the Kinds of
 * student tab on fee setup -- one screen in two places, so the two cannot
 * disagree -- because a kind of student is chosen at admission and the office
 * admitting a child looks for it here, not under fees.
 *
 * The policies on student_types and student_type_assignments are the
 * boundary: an administrator or an accountant writes both, and only they read
 * who is which kind. Anybody else is told so rather than shown an editor that
 * would refuse them.
 */
export default async function StudentTypesPage() {
  const ctx = await getUserContext();
  const canManage = STUDENT_TYPE_WRITERS.includes(ctx?.roleCode ?? "");
  const [types, typed, sections] = await Promise.all([
    listStudentTypes(),
    canManage ? listTypedStudents() : Promise.resolve([]),
    listSections(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Student Types" icon={Tags}>
        <Button asChild variant="outline">
          <Link href="/students/new">
            <UserPlus className="size-4" aria-hidden="true" />
            New Admission
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/fees/setup">
            <IndianRupee className="size-4" aria-hidden="true" />
            Fees by type
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Regular, Carry Forward, Carry-over, Private Candidate, Management Quota, Direct Admission and
        Admission Through Counselling are where every college starts. Add your own, switch off the
        ones you do not use, and give a kind its own fees under Fee Types.
      </p>
      {canManage ? (
        <StudentTypesPanel
          types={types}
          typedStudents={typed}
          sessionName={ctx?.currentSessionName ?? "this year"}
          sections={sections}
        />
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <ul className="flex flex-wrap gap-2" aria-label="Kinds of student">
            {types.filter((t) => t.isActive).map((t) => (
              <li key={t.id} className="rounded-md border px-3 py-1.5 text-sm">
                {t.name}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            An administrator or an accountant adds kinds of student and says who is which.
          </p>
        </div>
      )}
    </div>
  );
}
