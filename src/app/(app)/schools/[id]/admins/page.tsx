import Link from "next/link";
import { notFound } from "next/navigation";
import { List, Pencil, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getSchoolForEdit, listSchoolAdmins } from "../../actions";
import { AdminsManager } from "./admins-manager";

export const metadata = { title: "School Admins" };

/** One school's administrators (0326); `school_admins` refuses anybody who does not administer it. */
export default async function SchoolAdminsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [school, admins] = await Promise.all([getSchoolForEdit(id), listSchoolAdmins(id)]);
  if (!school.ok || !admins.ok) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={`Admins: ${school.data.name}`} icon={ShieldCheck}>
        <Button asChild variant="outline">
          <Link href={`/schools/${id}/edit`}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit School
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/schools/manage">
            <List className="size-4" aria-hidden="true" />
            View All
          </Link>
        </Button>
      </PageToolbar>
      <AdminsManager tenantId={id} schoolName={school.data.name} admins={admins.data} />
    </div>
  );
}
