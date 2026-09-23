import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listMyChildren } from "@/lib/auth/family";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import {
  scoreText,
  sittingState,
  sittingStateLabel,
} from "@/lib/validations/online-tests-display";
import {
  getResults,
  getTest,
  listCourses,
  listQuestions,
  listSittings,
  type QuestionStat,
  type ResultRow,
} from "../actions";
import { QuestionList, TestControls } from "../editor";
import { SitTest } from "../paper";

export const metadata = { title: "Online test" };

/**
 * One test. Three screens, chosen without a role code:
 *
 *  - **its own teacher, or an administrator** -- the course is one
 *    `teaching_courses()` returns -- writes the questions and reads results;
 *  - **anybody else holding `onlinetests.manage`** (a class teacher) reads the
 *    results, which `online_test_results` allows them, and nothing else;
 *  - **a family** -- `roleSubject` says whose record they are: a student sits
 *    it, a guardian sees their child's mark.
 *
 * None of these is a gate. The questions come through RLS (a student matches
 * no policy on them), and every write and the results are functions that ask
 * for themselves.
 */
export default async function OnlineTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [test, ctx, canManage, t, locale] = await Promise.all([
    getTest(id),
    getUserContext(),
    hasPermission("onlinetests.manage"),
    getT(),
    getLocale(),
  ]);
  // Under RLS "no such test" and "not yours" are the same answer (rule 15's
  // note on a 404's copy), so the page does not claim which.
  if (!test) notFound();

  const when = (iso: string) =>
    formatDateTime(iso, locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: test.timezone,
    });
  const now = Date.now();
  const isOpen = now >= Date.parse(test.opensAt) && now < Date.parse(test.closesAt);
  const closed = now >= Date.parse(test.closesAt);

  const header = (
    <div className="flex flex-col gap-2">
      <Link href="/online-tests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Online tests
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold break-words">{test.title}</h1>
        <Badge variant={test.status === "published" ? "secondary" : "outline"}>
          {test.status === "published" ? "Published" : "Draft"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        <bdi>{test.classLabel}</bdi> · <bdi>{test.subjectName}</bdi> · {test.durationMinutes} minutes each
      </p>
      <p className="text-sm">
        Open <time dateTime={test.opensAt}>{when(test.opensAt)}</time> –{" "}
        <time dateTime={test.closesAt}>{when(test.closesAt)}</time>
      </p>
    </div>
  );

  if (canManage) {
    const courses = await listCourses();
    const own = courses.some((c) => c.value === test.course);
    const [questions, results] = await Promise.all([own ? listQuestions(test.id) : Promise.resolve([]), getResults(test.id)]);

    return (
      <div className="flex flex-col gap-8">
        {header}
        {own ? (
          <>
            <TestControls testId={test.id} status={test.status} questionCount={questions.length} sittings={test.sittings} />
            <section aria-labelledby="questions-heading" className="flex flex-col gap-3">
              <h2 id="questions-heading" className="text-lg font-semibold">
                Questions · {test.totalMarks} {test.totalMarks === 1 ? "mark" : "marks"}
              </h2>
              {test.status === "published" ? (
                <p className="text-sm text-muted-foreground">
                  Published, so the questions and the key are fixed
                  {test.sittings > 0 ? " — somebody has started it" : ". Take it back to draft to change them"}.
                </p>
              ) : null}
              <QuestionList testId={test.id} questions={questions} editable={test.status === "draft"} />
            </section>
          </>
        ) : null}
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-lg font-semibold">
            Results
          </h2>
          {"error" in results ? (
            <p className="text-sm text-muted-foreground">{results.error}</p>
          ) : (
            <Results
              rows={results.rows}
              questions={results.questions}
              label={(s) => sittingStateLabel(s, t)}
              when={when}
            />
          )}
        </section>
      </div>
    );
  }

  // A family.
  const sittings = (await listSittings()).filter((s) => s.testId === test.id);

  if (ctx?.roleSubject === "student") {
    const mine = sittings[0] ?? null;
    const state = sittingState(mine, now);
    return (
      <div className="flex flex-col gap-6">
        {header}
        {mine?.submittedAt ? (
          <p className="font-medium" role="status">
            Your mark: {scoreText(mine.score, mine.maxScore)}
          </p>
        ) : state === "lapsed" ? (
          <p className="text-sm">Time ran out. Open it once more to have it marked on what was saved.</p>
        ) : null}
        <SitTest
          testId={test.id}
          started={!!mine}
          submitted={!!mine?.submittedAt || (state === "lapsed" && closed)}
          canReview={closed && test.revealAnswers}
          isOpen={isOpen}
          opensLabel={
            closed
              ? "This test has closed, and you did not start it."
              : `This test opens ${when(test.opensAt)}.`
          }
        />
      </div>
    );
  }

  const children = await listMyChildren();
  return (
    <div className="flex flex-col gap-6">
      {header}
      <ul className="flex flex-col gap-2">
        {children.map((c) => {
          const s = sittings.find((x) => x.studentId === c.studentId) ?? null;
          const state = sittingState(s, now);
          return (
            <li key={c.studentId} className="rounded-lg border border-border bg-card p-3 text-sm">
              <bdi className="font-medium">{c.name}</bdi>: {sittingStateLabel(state, t)}
              {s?.submittedAt ? ` · ${scoreText(s.score, s.maxScore)}` : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Results({
  rows,
  questions,
  label,
  when,
}: {
  rows: ResultRow[];
  questions: QuestionStat[];
  label: (state: string) => string;
  when: (iso: string) => string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody is enrolled in this class this year.</p>;
  }
  const submitted = rows.filter((r) => r.state === "submitted");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        {submitted.length} of {rows.length} {rows.length === 1 ? "student" : "students"}{" "}
        {submitted.length === 1 ? "has" : "have"} submitted.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">Student</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">State</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">Mark</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">Handed in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.studentId}>
                <td className="px-3 py-2">
                  <bdi className="font-medium">{r.name}</bdi>
                  <span className="block text-xs text-muted-foreground">{r.admissionNumber}</span>
                </td>
                <td className="px-3 py-2">{label(r.state)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.score != null ? scoreText(r.score, r.maxScore) : "—"}
                  {r.provisional && r.score != null ? (
                    <span className="block text-xs text-muted-foreground">from saved answers</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.submittedAt ? when(r.submittedAt) : "—"}
                  {r.submittedLate ? <span className="block text-xs text-muted-foreground">after time</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {submitted.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">How each question went</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {questions.map((q, i) => (
              <li key={q.id}>
                {i + 1}. <span className="break-words">{q.prompt}</span>{" "}
                <span className="text-muted-foreground">
                  — {q.correct} of {submitted.length} right
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
