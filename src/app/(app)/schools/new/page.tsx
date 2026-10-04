import Link from "next/link";
import { List, School } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { getT } from "@/lib/i18n/server";
import { TIMEZONES } from "@/lib/validations/platform-display";
import { StartForm } from "../../../start/start-form";
import { addSchool, listMySchools } from "../actions";

export const metadata = { title: "Add New School" };

/**
 * The reference's Add New School. The same fields as founding a first school,
 * through the same form; `school_add` (0323) is the gate, and refuses anybody
 * without users.manage in a sentence. The button is drawn on that permission.
 */
export default async function AddSchoolPage() {
  const [canAdd, t, mine] = await Promise.all([hasPermission("users.manage"), getT(), listMySchools()]);
  const copySources = mine.filter((s) => s.isAdmin).map((s) => ({ id: s.tenantId, name: s.name }));

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={t("schools.new.title")} icon={School}>
        <Button asChild variant="outline">
          <Link href="/schools/manage">
            <List className="size-4" aria-hidden="true" />
            {t("schools.viewAll")}
          </Link>
        </Button>
      </PageToolbar>
      {canAdd ? (
        <div className="form-card mx-auto w-full max-w-xl rounded-lg border bg-card p-6">
          <p className="mb-5 text-sm text-muted-foreground">{t("schools.new.intro")}</p>
          <StartForm
            timezones={TIMEZONES}
            action={addSchool}
            submitLabel={t("schools.add")}
            note="The new school starts on a thirty-day trial, as every new school does."
            copySources={copySources}
          />
        </div>
      ) : (
        <p className="max-w-2xl text-sm text-muted-foreground">{t("schools.new.cannot")}</p>
      )}
    </div>
  );
}
