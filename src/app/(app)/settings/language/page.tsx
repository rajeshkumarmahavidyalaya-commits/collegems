import { AlertTriangle, Languages } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, getT } from "@/lib/i18n/server";
import { LOCALES, directionOf, type Locale } from "@/lib/i18n/config";
import { allCoverage, coverageProblems } from "@/lib/i18n/coverage";
import { getUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";

export const metadata = { title: "Language" };

export default async function LanguagePage() {
  const [t, locale, ctx] = await Promise.all([getT(), getLocale(), getUserContext()]);

  let schoolLocale: Locale = "en";
  if (ctx) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("tenants")
      .select("default_locale")
      .eq("id", ctx.tenantId)
      .maybeSingle();
    if (data?.default_locale) schoolLocale = data.default_locale as Locale;
  }

  const coverage = allCoverage();
  const problems = coverageProblems();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("settings.language.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("settings.language.body")}
          </p>
        </div>
        <LanguageSwitcher schoolLocale={schoolLocale} />
      </div>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2">
            <Languages className="size-4" aria-hidden="true" />
            {t("app.language")}
          </CardTitle>
          <CardDescription>{t("settings.language.rtlNote")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {LOCALES.map((entry) => {
            const stats = coverage.find((c) => c.locale === entry.code)!;
            return (
              <div key={entry.code} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span dir={entry.direction} className="font-medium">
                    {entry.nativeName}
                  </span>
                  <span className="text-sm text-muted-foreground">{entry.englishName}</span>
                  {/* Meaning never rests on colour: the word is there too. */}
                  {entry.direction === "rtl" && (
                    <Badge variant="outline" className="font-normal">
                      right to left
                    </Badge>
                  )}
                  {locale === entry.code && (
                    <Badge variant="default" className="font-normal">
                      in use
                    </Badge>
                  )}
                  <span className="ms-auto font-mono text-sm tabular-nums">
                    {stats.percent}%
                  </span>
                </div>
                {/* A plain bar rather than a component: the number beside it
                    is the accessible answer, so this is decoration and is
                    hidden from a screen reader rather than duplicating it. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="h-full bg-primary" style={{ width: `${stats.percent}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats.translated} of {stats.total} messages translated
                  {stats.missing.length > 0 && "; the rest fall back to English"}.
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {problems.length > 0 && (
        // `coverageProblems()` is `grading_scheme_problems()` applied to a
        // catalogue: the runtime falls back silently because an English
        // sentence beats a raw key, so the honesty has to live somewhere a
        // person looks rather than in the screen a parent is reading.
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {problems.length === 1
              ? "One thing to look at"
              : `${problems.length} things to look at`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-inside list-disc">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground">
        The interface currently runs {directionOf(locale) === "rtl" ? "right to left" : "left to right"}.
      </p>
    </div>
  );
}
