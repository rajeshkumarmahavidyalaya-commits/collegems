import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { hasPermission } from "@/lib/auth/permissions";
import { listMyChildren } from "@/lib/auth/family";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/i18n/format";
import {
  scoreText,
  sittingState,
  sittingStateLabel,
} from "@/lib/validations/online-tests-display";
import { listCourses, listSittings, listTests, type TestRow } from "./actions";
import { NewTestButton } from "./tests-view";

export const metadata = { title: "Online tests" };

/**
 * Online tests: the teacher's list of what they have set, or a family's list of
 * what is open to them.
 *
 * Which of the two is decided by `onlinetests.manage` -- the permission, not a
 * role code (rule 4's "a tier written out as role codes is a copy"). RLS decides
 * which tests come back to either: a teacher's own courses, a family's
 * published tests for their children's classes.
 */
export default async function OnlineTestsPage() {
  const [canView, canManage, t, locale] = await Promise.all([
    hasPermission("onlinetests.view"),
    hasPermission("onlinetests.manage"),
    getT(),
    getLocale(),
  ]);

  if (!canView && !canManage) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("onlineTests.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("onlineTests.noAccess")}</p>
      </div>
    );
  }

  const tests = await listTests();
  // Times where the college is: a Server Component on Vercel runs in UTC.
  const when = (iso: string, tz: string) =>
    formatDateTime(iso, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });

  if (canManage) {
    const courses = await listCourses();
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t("onlineTests.title")}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("onlineTests.subtitle")}</p>
          </div>
          <NewTestButton courses={courses} />
        </div>
        {tests.length === 0 ? (
          <Empty text={t("onlineTests.empty")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {tests.map((test) => (
              <li key={test.id}>
                <Link
                  href={`/online-tests/${test.id}`}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">{test.title}</span>
                    <Badge variant={test.status === "published" ? "secondary" : "outline"}>
                      {test.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    <bdi>{test.classLabel}</bdi> · <bdi>{test.subjectName}</bdi> · {test.questionCount}{" "}
                    {test.questionCount === 1 ? "question" : "questions"} · {test.durationMinutes} min
                  </span>
                  <span className="text-sm">
                    {when(test.opensAt, test.timezone)} – {when(test.closesAt, test.timezone)}
                    {test.sittings > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {test.submitted} of {test.sittings} who started {test.submitted === 1 ? "has" : "have"} submitted
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // A family: their own sittings, or their children's, beside each test.
  const [sittings, children] = await Promise.all([listSittings(), listMyChildren()]);
  const nameOf = new Map(children.map((c) => [c.studentId, c.name]));
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("onlineTests.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("onlineTests.familySubtitle")}</p>
      </div>
      {tests.length === 0 ? (
        <Empty text={t("onlineTests.familyEmpty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {tests.map((test) => (
            <FamilyTest
              key={test.id}
              test={test}
              when={when}
              now={now}
              rows={sittings
                .filter((s) => s.testId === test.id)
                .map((s) => ({
                  who: children.length > 1 ? (nameOf.get(s.studentId) ?? null) : null,
                  state: sittingStateLabel(sittingState(s, now), t),
                  score: s.submittedAt ? scoreText(s.score, s.maxScore) : null,
                }))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FamilyTest({
  test,
  when,
  now,
  rows,
}: {
  test: TestRow;
  when: (iso: string, tz: string) => string;
  now: number;
  rows: { who: string | null; state: string; score: string | null }[];
}) {
  const open = now >= Date.parse(test.opensAt) && now < Date.parse(test.closesAt);
  const closed = now >= Date.parse(test.closesAt);
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium break-words">{test.title}</span>
        <span className="text-sm text-muted-foreground">
          <bdi>{test.subjectName}</bdi> · <bdi>{test.classLabel}</bdi> · {test.durationMinutes} minutes
        </span>
        <span className="text-sm">
          {closed ? "Closed " : open ? "Open until " : "Opens "}
          {closed || open ? when(test.closesAt, test.timezone) : when(test.opensAt, test.timezone)}
        </span>
        {rows.map((r, i) => (
          <span key={i} className="text-sm">
            {r.who ? <bdi className="font-medium">{r.who}: </bdi> : null}
            {r.state}
            {r.score ? ` · ${r.score}` : null}
          </span>
        ))}
      </div>
      <Link
        href={`/online-tests/${test.id}`}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
      >
        Open
      </Link>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <ClipboardList className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
