import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listMyChildren } from "@/lib/auth/family";
import { formatDate } from "@/lib/i18n/format";
import { getLocale, getT } from "@/lib/i18n/server";
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
  const [ctx, locale, t] = await Promise.all([getUserContext(), getLocale(), getT()]);

  if (ctx?.roleTier === "student") {
    const [marks, children] = await Promise.all([myChildrenTestMarks(), listMyChildren()]);
    const names = new Map(children.map((c) => [c.studentId, c.name]));
    const showName = children.length > 1;
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">{t("classTests.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("classTests.familyIntro")}</p>
        </div>
        {marks.length === 0 ? (
          <Empty text={t("classTests.familyEmpty")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.date")}</th>
                  {showName && <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.child")}</th>}
                  <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.subject")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.test")}</th>
                  <th scope="col" className="p-2 text-end font-medium">{t("classTests.col.marks")}</th>
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
                      {m.absent ? t("classTests.absent") : t("classTests.outOf", { marks: m.marks ?? "", max: m.maxMarks })}
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
        <h1 className="text-2xl font-semibold">{t("classTests.title")}</h1>
        <Empty text={t("classTests.notYours")} />
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
          <h1 className="text-2xl font-semibold">{t("classTests.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("classTests.staffIntro")}</p>
        </div>
        {(canGrade || canManage) && <NewTestDialog options={options} today={today} />}
      </div>

      {(canGrade || canManage) && options.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("classTests.noSubjects")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("classTests.thisYear")}</CardTitle>
        </CardHeader>
        <CardContent>
          {tests.length === 0 ? (
            <Empty text={t("classTests.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.date")}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.class")}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.subject")}</th>
                    <th scope="col" className="p-2 text-start font-medium">{t("classTests.col.test")}</th>
                    <th scope="col" className="p-2 text-end font-medium">{t("classTests.col.entered")}</th>
                    <th scope="col" className="p-2 text-end font-medium">{t("classTests.col.average")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((test) => (
                    <tr key={test.id} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap">{formatDate(test.heldOn, locale)}</td>
                      <td className="p-2">{test.classLabel}</td>
                      <td className="p-2">{test.subjectName}</td>
                      <td className="p-2">
                        <Link href={`/class-tests/${test.id}`} className="font-medium underline-offset-2 hover:underline">
                          {test.title}
                        </Link>
                      </td>
                      <td className="p-2 text-end tabular-nums">{test.entered}</td>
                      <td className="p-2 text-end font-mono tabular-nums">
                        {test.average === null ? "—" : t("classTests.outOf", { marks: test.average, max: test.maxMarks })}
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
