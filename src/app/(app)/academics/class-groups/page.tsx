import Link from "next/link";
import { ArrowLeft, FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { listStaffOptions } from "../../hr/actions";
import { listClassGroups } from "../class-group-actions";
import { ClassGroupsView } from "./class-groups-view";

export const metadata = { title: "Class groups" };

/**
 * The reference's Class Groups (0341). Every member of the college may read
 * the list; the administrator writes it, through `class_group_save`, so the
 * form is drawn for the administrator alone.
 */
export default async function ClassGroupsPage() {
  const ctx = await getUserContext();
  const canManage = ctx?.roleCode === "admin";
  const [{ groups, classes }, staff] = await Promise.all([
    listClassGroups(),
    canManage ? listStaffOptions() : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Class Groups" icon={FolderTree}>
        <Button asChild variant="outline">
          <Link href="/academics">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Manage Classes
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Groups of classes, such as Science, Arts or Primary, each with the member of staff who heads it. A class is in one group at most.
      </p>
      <ClassGroupsView groups={groups} classes={classes} staff={staff} canManage={canManage} />
    </div>
  );
}
