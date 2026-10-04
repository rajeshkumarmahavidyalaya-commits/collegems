import Link from "next/link";
import { LayoutGrid, Pencil, Plus, School, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageToolbar } from "@/components/page-toolbar";
import { SuccessNotice } from "@/components/success-notice";
import { hasPermission } from "@/lib/auth/permissions";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/i18n/format";
import { listMySchools, listSchoolFigures } from "../actions";
import { OpenSchoolButton, PauseSchoolButton } from "../school-card";

export const metadata = { title: "Schools" };

/**
 * The reference's Schools table: name, phone, email, address, number of
 * classes, admins, status and an action. The counts come from `my_schools`
 * only for schools this login administers; elsewhere they are a dash, never
 * a zero. The action opens the school through the same switch the dashboard
 * cards use.
 */
export default async function SchoolsListPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; copied?: string }>;
}) {
  const params = await searchParams;
  const added = (params.added ?? "").slice(0, 120);
  const copied = (params.copied ?? "").slice(0, 200);
  const [schools, figures, canAdd, t, locale] = await Promise.all([
    listMySchools(),
    listSchoolFigures(),
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
      {added && (
        <SuccessNotice title={`School "${added}" was created.`}>
          {copied.startsWith("failed:")
            ? `Its setup was not copied: ${copied.slice(7)} Open it to add classes, sections and staff.`
            : copied
              ? `${copied} classes, with their sections, subjects, periods and fees, were copied into it. Open it to add staff and students.`
              : "It has its own academic year and starts empty. Open it to add classes, sections and staff — the Setup Wizard walks through each step."}
        </SuccessNotice>
      )}
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
                  const paused = figures.get(s.tenantId)?.isPaused === true;
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
                        {paused ? (
                          <Badge variant="warning">Paused</Badge>
                        ) : (
                          <Badge variant={active ? "default" : "secondary"}>
                            {active ? t("schools.status.active") : t("schools.status.inactive")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-start gap-1.5">
                          {s.isCurrent ? (
                            <span className="inline-flex h-8 items-center text-sm font-medium">{t("schools.current")}</span>
                          ) : (
                            <OpenSchoolButton tenantId={s.tenantId} name={s.name} disabled={!s.isActive} />
                          )}
                          {/* Drawn where my_schools says this login administers the
                              school; each function refuses anybody else anyway. */}
                          {s.isAdmin && (
                            <>
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/schools/${s.tenantId}/edit`}>
                                  <Pencil className="size-3.5" aria-hidden="true" />
                                  Edit
                                </Link>
                              </Button>
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/schools/${s.tenantId}/admins`}>
                                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                                  Admins
                                </Link>
                              </Button>
                              <PauseSchoolButton tenantId={s.tenantId} name={s.name} paused={paused} />
                            </>
                          )}
                        </div>
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
