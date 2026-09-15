import { getUserContext } from "@/lib/auth/context";
import { listMyChildren } from "@/lib/auth/family";
import { hasPermission } from "@/lib/auth/permissions";
import { schoolToday } from "@/lib/validations/homework";
import {
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
 *
 * **Which screen is a question about the audience, so it is answered by the
 * audience column.** This read `roleCode === "admin" || roleCode === "teacher"`
 * — two of the four staff roles written out by hand — so an accountant and a
 * librarian, both of whom the menu offered this entry, fell through to the
 * *family* screen. Measured as each of them against the live college:
 * `homework` **0 rows** and `family_my_students()` **0**, because neither role
 * has a SELECT policy on `homework` at all. Two seats were shown a family's
 * screen, addressed to them as a family, with nothing on it.
 *
 * `roleTier` is the column that says which of the three audiences somebody
 * belongs to (migration `0208`), and this is exactly what it is for: it decides
 * what a person is **shown**, never what they may do. What they may do is
 * `hasPermission("homework.manage")` further down, and underneath that the
 * policies.
 */
export default async function HomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const ctx = await getUserContext();

  return ctx?.roleTier === "student" ? (
    <FamilyView searchParams={searchParams} ctx={ctx} />
  ) : (
    <StaffView />
  );
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
  const children = await listMyChildren();

  // A student passes nothing and the RPC resolves their own record. A guardian
  // names a child, and the enrolment join under RLS is what decides whether
  // that was one of theirs — the `?student=` in the URL is a convenience, not
  // a key.
  //
  // `roleSubject` and not `roleCode`, for the reason the tier is used above:
  // **whose record this login stands for** is a property of the role, written
  // down on `roles.subject` by migration `0224`, and a college that adds a
  // second guardian-facing role gets the same behaviour without this line being
  // edited. The tier cannot answer it — `parent` and `student` share one.
  const studentId =
    ctx?.roleSubject === "guardian" ? (params.student ?? children[0]?.studentId) : undefined;

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
        canSubmit={ctx?.roleSubject === "student"}
      />
    </div>
  );
}
