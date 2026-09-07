import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listAllNotices } from "../actions";
import { ManageNotices } from "./manage-notices";
import { listRoles } from "../../notifications/actions";
import { listSections } from "../../students/actions";
import { hasPermission } from "@/lib/auth/permissions";

export const metadata = { title: "Manage notices" };

export default async function ManageNoticesPage() {
  // The matrix, not the shape of the page. RLS already refuses the writes, so
  // this only decides whether somebody is sent somewhere they can do nothing.
  const canWrite = await hasPermission("notices.manage");
  if (!canWrite) redirect("/notices");

  const [notices, sections, roles] = await Promise.all([
    listAllNotices(),
    listSections(),
    listRoles(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/notices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          Notice board
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Manage notices</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Drafts, published notices and withdrawn ones. Publishing announces a notice once; editing
          it afterwards never does.
        </p>
      </div>

      <ManageNotices notices={notices} sections={sections} roles={roles} />
    </div>
  );
}
