import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/i18n/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { getTestSheet } from "../actions";
import { TestSheet } from "./test-sheet";

export const metadata = { title: "Class test" };

/**
 * One test's mark sheet (0304). The class list comes from teaching_roster, so
 * the subject teacher sees the class they teach even when they are not its
 * class teacher; anybody else gets the database's sentence, not an empty class.
 */
export default async function ClassTestPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  const [{ test, rows, refused }, locale, t] = await Promise.all([getTestSheet(testId), getLocale(), getT()]);
  if (!test) notFound();

  const sat = rows.filter((r) => !r.absent && r.marks !== null);
  const average = sat.length ? Math.round((sat.reduce((s, r) => s + (r.marks ?? 0), 0) / sat.length) * 10) / 10 : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {test.classLabel} · {test.subjectName} · {formatDate(test.heldOn, locale)}
          </p>
          <h1 className="text-2xl font-semibold">{test.title}</h1>
          <p className="text-sm text-muted-foreground">
            {t("classTests.sheet.summary", { max: test.maxMarks, entered: test.entered, total: rows.length })}
            {average !== null ? ` · ${t("classTests.sheet.average", { average })}` : ""}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/class-tests">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            {t("classTests.sheet.allTests")}
          </Link>
        </Button>
      </div>

      {refused ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ShieldAlert className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">{refused}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("classTests.sheet.whoEnters")}</p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t("classTests.sheet.nobody")}
          </CardContent>
        </Card>
      ) : (
        <TestSheet testId={test.id} maxMarks={test.maxMarks} rows={rows} />
      )}
    </div>
  );
}
