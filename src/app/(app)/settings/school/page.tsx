import { AlertTriangle, Settings2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { hasPermission } from "@/lib/auth/permissions";
import { severityTone } from "@/lib/validations/settings";
import { listSettingProblems, listSettings } from "./actions";
import { SettingsList } from "./settings-list";

export const metadata = { title: "School settings" };

/**
 * Everything a school can configure, rendered from the catalogue.
 *
 * There is no `if (key === "school.profile")` anywhere on this page, and adding
 * one would be the mistake the catalogue exists to prevent: a new setting is a
 * row in a migration, and this screen renders it without being edited. Same
 * bargain as `/reports`.
 */
export default async function SchoolSettingsPage() {
  const [settings, problems, canManage] = await Promise.all([
    listSettings(),
    listSettingProblems(),
    hasPermission("settings.manage"),
  ]);

  const modules = [...new Set(settings.map((s) => s.module))];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">School settings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          What this school has decided, as opposed to what the software assumes. Anything left
          alone uses the default, and the difference is shown against each one.
        </p>
      </div>

      {!canManage && (
        <Alert>
          <Settings2 className="size-4" aria-hidden="true" />
          <AlertTitle>You can see these but not change them</AlertTitle>
          <AlertDescription>
            Settings are the office&rsquo;s. They are shown here because a fine rate or a school
            address is not a secret &mdash; and nothing secret is ever kept here.
          </AlertDescription>
        </Alert>
      )}

      {problems.length > 0 && (
        <section aria-labelledby="problems-heading" className="flex flex-col gap-2">
          <h2 id="problems-heading" className="text-lg font-semibold">
            Worth attending to
          </h2>
          <ul className="flex flex-col gap-2">
            {problems.map((problem, index) => (
              <li key={`${problem.key}-${index}`}>
                <Alert>
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle className="flex items-center gap-2">
                    <Badge variant={severityTone(problem.severity)}>
                      {problem.severity === "warning" ? "Not filled in" : "Note"}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription>{problem.message}</AlertDescription>
                </Alert>
              </li>
            ))}
          </ul>
        </section>
      )}

      {modules.map((module) => (
        <section key={module} aria-labelledby={`module-${module}`} className="flex flex-col gap-3">
          <h2 id={`module-${module}`} className="text-lg font-semibold">
            {module}
          </h2>
          <SettingsList
            settings={settings.filter((s) => s.module === module)}
            canManage={canManage}
          />
        </section>
      ))}
    </div>
  );
}
