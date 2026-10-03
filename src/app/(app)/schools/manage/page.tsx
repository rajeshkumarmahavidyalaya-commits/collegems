import Link from "next/link";
import { LayoutGrid, Plus, School } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/i18n/format";
import { listMySchools } from "../actions";
import { OpenSchoolButton } from "../school-card";

export const metadata = { title: "Schools" };

/**
 * The reference's Schools table: name, phone, email, address, number of
 * classes, admins, status and an action. The counts come from `my_schools`
 * only for schools this login administers; elsewhere they are a dash, never
 * a zero. The action opens the school through the same switch the dashboard
 * cards use.
 */
export default async function SchoolsListPage() {
  const [schools, canAdd, t, locale] = await Promise.all([
    listMySchools(),
    hasPermission("users.manage"),
    getT(),
    getLocale(),
  ]);
  const dash = "—";

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={t("schools.list.title")} icon={School}>
        <Button asChild variant="outline">
          <Link href="/schools">
            <LayoutGrid className="size-4" aria-hidden="true" />
            {t("schools.title")}
          </Link>
        </Button>
        {canAdd && (
          <Button asChild variant="outline">
            <Link href="/schools/new">
              <Plus className="size-4" aria-hidden="true" />
              {t("schools.add")}
            </Link>
          </Button>
        )}
      </PageToolbar>
      {schools.length === 0 ? (
        <p className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">{t("schools.superAdminOnly")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("schools.col.name")}</TableHead>
                  <TableHead>{t("schools.phone")}</TableHead>
                  <TableHead>{t("schools.email")}</TableHead>
                  <TableHead>{t("schools.address")}</TableHead>
                  <TableHead className="text-end">{t("schools.col.classes")}</TableHead>
                  <TableHead className="text-end">{t("schools.col.admins")}</TableHead>
                  <TableHead>{t("schools.status")}</TableHead>
                  <TableHead>{t("schools.col.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schools.map((s) => {
                  const active = s.planStatus === "active" || s.planStatus === "trialing";
                  return (
                    <TableRow key={s.tenantId} aria-current={s.isCurrent ? "true" : undefined}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.phone ?? dash}</TableCell>
                      <TableCell className="max-w-48 truncate">{s.email ?? dash}</TableCell>
                      <TableCell className="max-w-64">{s.address ?? dash}</TableCell>
                      <TableCell className="text-end tabular-nums">
                        {s.classCount === null ? dash : formatNumber(s.classCount, locale)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {s.adminCount === null ? dash : formatNumber(s.adminCount, locale)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={active ? "default" : "secondary"}>
                          {active ? t("schools.status.active") : t("schools.status.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {s.isCurrent ? (
                          <span className="text-sm font-medium">{t("schools.current")}</span>
                        ) : (
                          <OpenSchoolButton tenantId={s.tenantId} name={s.name} disabled={!s.isActive} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {schools.some((s) => !s.isAdmin) && <p className="text-xs text-muted-foreground">{t("schools.notAdmin")}</p>}
        </>
      )}
    </div>
  );
}
