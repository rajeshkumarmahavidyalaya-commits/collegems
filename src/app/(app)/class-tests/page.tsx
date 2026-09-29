import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listMyChildren } from "@/lib/auth/family";
import { formatDate } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { listTeachingOptions, listTests, myChildrenTestMarks } from "./actions";
import { NewTestDialog } from "./new-test-dialog";

export const metadata = { title: "Class tests" };

/**
 * Class tests (0304): the weekly test, the quiz, the unit test -- marks a
 * teacher keeps between examinations.
 *
 * One address, two screens, chosen by `roleTier` (what to show) and never by
 * role codes (rule 4's "a tier written out as role codes is a copy"). A family
 * sees their own children's marks; staff see the tests they may mark. What
 * anybody may do is still the policies' and `hasPermission`'s.
 */
export default async function ClassTestsPage() {
  const [ctx, locale] = await Promise.all([getUserContext(), getLocale()]);

  if (ctx?.roleTier === "student") {
    const [marks, children] = await Promise.all([myChildrenTestMarks(), listMyChildren()]);
    const names = new Map(children.map((c) => [c.studentId, c.name]));
    const showName = children.length > 1;
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Class tests</h1>
          <p className="text-sm text-muted-foreground">
            Marks from weekly and unit tests, as the teacher enters them.
          </p>
        </div>
        {marks.length === 0 ? (
          <Empty text="No class test marks yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="p-2 text-start font-medium">Date</th>
                  {showName && <th scope="col" className="p-2 text-start font-medium">Child</th>}
                  <th scope="col" className="p-2 text-start font-medium">Subject</th>
                  <th scope="col" className="p-2 text-start font-medium">Test</th>
                  <th scope="col" className="p-2 text-end font-medium">Marks</th>
                </tr>
              </thead>
              <tbody>
                {marks.map((m, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2 whitespace-nowrap">{formatDate(m.heldOn, locale)}</td>
                    {showName && <td className="p-2">{names.get(m.studentId) ?? ""}</td>}
                    <td className="p-2">{m.subjectName}</td>
                    <td className="p-2">{m.title}</td>
                    <td className="p-2 text-end font-mono tabular-nums">
                      {m.absent ? "Absent" : `${m.marks} / ${m.maxMarks}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const [canGrade, canManage, canRemark] = await Promise.all([
    hasPermission("exams.grade"),
    hasPermission("exams.manage"),
    hasPermission("exams.remark"),
  ]);
  if (!canGrade && !canManage && !canRemark) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Class tests</h1>
        <Empty text="Class tests are kept by the teachers who set them and by the exams office." />
      </div>
    );
  }

  const supabase = await createClient();
  const [tests, options, todayRes] = await Promise.all([
    listTests(),
    canGrade || canManage ? listTeachingOptions() : Promise.resolve([]),
    supabase.rpc("mobile_today"),
  ]);
  const today = (todayRes.data as string | null) ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Class tests</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Weekly and unit tests between examinations. Set one, enter the marks, and the family sees
            them straight away. They are not on the report card: that is what examinations are for.
          </p>
        </div>
        {(canGrade || canManage) && <NewTestDialog options={options} today={today} />}
      </div>

      {(canGrade || canManage) && options.length === 0 && (
        <p className="text-sm text-muted-foreground">
          You are not down to teach any subject this year, so there is no class to set a test in.
          Subjects and their teachers are set under Academics.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This year&apos;s tests</CardTitle>
        </CardHeader>
        <CardContent>
          {tests.length === 0 ? (
            <Empty text="No class tests yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="p-2 text-start font-medium">Date</th>
                    <th scope="col" className="p-2 text-start font-medium">Class</th>
                    <th scope="col" className="p-2 text-start font-medium">Subject</th>
                    <th scope="col" className="p-2 text-start font-medium">Test</th>
                    <th scope="col" className="p-2 text-end font-medium">Entered</th>
                    <th scope="col" className="p-2 text-end font-medium">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap">{formatDate(t.heldOn, locale)}</td>
                      <td className="p-2">{t.classLabel}</td>
                      <td className="p-2">{t.subjectName}</td>
                      <td className="p-2">
                        <Link href={`/class-tests/${t.id}`} className="font-medium underline-offset-2 hover:underline">
                          {t.title}
                        </Link>
                      </td>
                      <td className="p-2 text-end tabular-nums">{t.entered}</td>
                      <td className="p-2 text-end font-mono tabular-nums">
                        {t.average === null ? "—" : `${t.average} / ${t.maxMarks}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
      <ClipboardCheck className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
