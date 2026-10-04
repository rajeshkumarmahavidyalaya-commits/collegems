import Link from "next/link";
import { List, Plus, School } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { SuccessNotice } from "@/components/success-notice";
import { hasPermission } from "@/lib/auth/permissions";
import { getT } from "@/lib/i18n/server";
import { listMySchools, listSchoolFigures } from "./actions";
import { SchoolCard } from "./school-card";

export const metadata = { title: "School Management" };

/**
 * The reference's first page: School Management > Dashboard, a card per
 * school this login belongs to, the current one highlighted. Choosing a card
 * makes that school the one every other screen works in (`school_switch`,
 * 0323). Only the super admin chooses (0325): `my_schools` lists the
 * caller's own colleges where their role holds users.manage, and nothing for
 * anybody else, who is told so. One school is visible at a time, because the
 * college is in the token and every policy reads it from there.
 */
export default async function SchoolsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const created = ((await searchParams).created ?? "").slice(0, 120);
  const [schools, figures, canAdd, t] = await Promise.all([
    listMySchools(),
    listSchoolFigures(),
    hasPermission("users.manage"),
    getT(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar title={t("schools.title")} icon={School}>
        {schools.length > 0 && (
          <Button asChild variant="outline">
            <Link href="/schools/manage">
              <List className="size-4" aria-hidden="true" />
              {t("schools.list.title")}
            </Link>
          </Button>
        )}
        {canAdd && (
          <Button asChild variant="outline">
            <Link href="/schools/new">
              <Plus className="size-4" aria-hidden="true" />
              {t("schools.add")}
            </Link>
          </Button>
        )}
      </PageToolbar>
      {created && (
        <SuccessNotice title={`School "${created}" was created.`}>
          It has its own academic year and starts empty. Open it to add classes, sections and staff —
          the Setup Wizard walks through each step.
        </SuccessNotice>
      )}
      {schools.length > 0 && <p className="text-sm text-muted-foreground">{t("schools.intro")}</p>}
      {schools.length === 0 ? (
        <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">{t("schools.superAdminOnly")}</p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" role="list">
          {schools.map((s) => (
            <li key={s.tenantId} className="min-w-0">
              <SchoolCard school={s} figures={figures.get(s.tenantId)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
