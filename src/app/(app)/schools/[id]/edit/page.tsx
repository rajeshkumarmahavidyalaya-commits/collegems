import Link from "next/link";
import { notFound } from "next/navigation";
import { List, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getSchoolForEdit, listMySchools } from "../../actions";
import { SchoolEditForm } from "./school-edit-form";

export const metadata = { title: "Edit School" };

/**
 * Edit one school the caller administers, possibly not the one they are
 * working in (0326, 0327). `school_profile` refuses anybody else, and the
 * page then says so in the not-found voice: a page that distinguished "no
 * such school" from "not yours" would be a way of asking which exist.
 */
export default async function EditSchoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [school, mine] = await Promise.all([getSchoolForEdit(id), listMySchools()]);
  if (!school.ok || !school.data.name) notFound();
  const copySources = mine.filter((s) => s.isAdmin && s.tenantId !== id).map((s) => ({ id: s.tenantId, name: s.name }));

  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={`Edit School: ${school.data.name}`} icon={Pencil}>
        <Button asChild variant="outline">
          <Link href={`/schools/${id}/admins`}>
            <Users className="size-4" aria-hidden="true" />
            Admins
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/schools/manage">
            <List className="size-4" aria-hidden="true" />
            View All
          </Link>
        </Button>
      </PageToolbar>
      <SchoolEditForm school={school.data} copySources={copySources} />
    </div>
  );
}
