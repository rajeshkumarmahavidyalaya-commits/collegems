import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { schoolToday } from "@/lib/validations/homework";
import {
  listChildren,
  listCurriculum,
  listFilesByOwner,
  listHomework,
  getStudentHomework,
} from "./actions";
import { HomeworkList, HomeworkSummary } from "./homework-list";
import { StudentHomework } from "./student-homework";

export const metadata = { title: "Homework" };

/**
 * One route, two screens. A teacher's homework page is a list of things they
 * set; a family's is a list of things they have to do. They are the same noun
 * and completely different questions, and giving each its own URL would mean
 * telling a parent to visit a different address from their child.
 */
export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const ctx = await getUserContext();
  const isStaff = ctx?.roleCode === "admin" || ctx?.roleCode === "teacher";

  return isStaff ? <StaffView /> : <FamilyView searchParams={searchParams} ctx={ctx} />;
}

async function StaffView() {
  const [ctx, homework, curriculum, canManage] = await Promise.all([
    getUserContext(),
    listHomework(),
    listCurriculum(),
    hasPermission("homework.manage"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Homework</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          What you have set for {ctx?.currentSessionName ?? "the current session"}, and how much of
          it has come back. Files attach to the assignment for the question and to a submission for
          the answer.
        </p>
      </div>

      <HomeworkSummary homework={homework} />

      <HomeworkList
        homework={homework}
        curriculum={curriculum}
        today={schoolToday()}
        canManage={canManage}
      />
    </div>
  );
}

async function FamilyView({
  searchParams,
  ctx,
}: {
  searchParams: Promise<{ student?: string }>;
  ctx: Awaited<ReturnType<typeof getUserContext>>;
}) {
  const params = await searchParams;
  const children = await listChildren();

  // A student passes nothing and the RPC resolves their own record. A parent
  // names a child, and the enrolment join under RLS is what decides whether
  // that was one of theirs — the `?student=` in the URL is a convenience, not
  // a key.
  const studentId =
    ctx?.roleCode === "parent" ? (params.student ?? children[0]?.id) : undefined;

  const rows = await getStudentHomework(studentId);
  const filesFor = await listFilesByOwner(
    rows.filter((r) => r.attachmentCount > 0).map((r) => r.homeworkId),
    rows
      .filter((r) => r.submissionId !== null && r.submissionFileCount > 0)
      .map((r) => r.submissionId!),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Homework</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Everything set for {ctx?.currentSessionName ?? "this session"}, soonest first. A piece
          that is not collected through the app still appears here — it is still homework.
        </p>
      </div>

      <StudentHomework
        rows={rows}
        today={schoolToday()}
        filesFor={filesFor}
        children_={children}
        selectedChildId={studentId}
        canSubmit={ctx?.roleCode === "student"}
      />
    </div>
  );
}
