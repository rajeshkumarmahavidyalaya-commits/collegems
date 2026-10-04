import Link from "next/link";
import { ArrowLeft, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { NamedListManager } from "@/components/named-list-manager";
import { getUserContext } from "@/lib/auth/context";
import { listNamed, removeNamed, saveNamed } from "../named-list-actions";

export const metadata = { title: "Mediums" };

/**
 * The reference's Manage Medium (0328). Every member of the college may read the
 * list; the administrator writes it, which is the policy on `mediums`, so the
 * add form is drawn for the administrator alone.
 */
export default async function MediumsPage() {
  const [rows, ctx] = await Promise.all([listNamed("mediums"), getUserContext()]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Mediums" icon={Languages}>
        <Button asChild variant="outline">
          <Link href="/students/new">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Admission form
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">The language a class is taught in. Each student&apos;s medium is chosen on the admission form, and printed on their record.</p>
      <NamedListManager
        rows={rows}
        words={{ title: "Mediums", one: "Medium", placeholder: "Enter medium (Hindi, English)" }}
        canManage={ctx?.roleCode === "admin"}
        save={saveNamed.bind(null, "mediums")}
        remove={removeNamed.bind(null, "mediums")}
      />
    </div>
  );
}
