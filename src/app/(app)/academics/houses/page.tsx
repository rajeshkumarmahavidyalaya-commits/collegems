import Link from "next/link";
import { ArrowLeft, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { NamedListManager } from "@/components/named-list-manager";
import { getUserContext } from "@/lib/auth/context";
import { listNamed, removeNamed, saveNamed } from "../named-list-actions";

export const metadata = { title: "Houses" };

/**
 * The reference's Manage House (0328). Every member of the college may read the
 * list; the administrator writes it, which is the policy on `houses`, so the
 * add form is drawn for the administrator alone.
 */
export default async function HousesPage() {
  const [rows, ctx] = await Promise.all([listNamed("houses"), getUserContext()]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Houses" icon={Flag}>
        <Button asChild variant="outline">
          <Link href="/students/new">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Admission form
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">The houses students are divided into for sports and activities. Each student&apos;s house is chosen on the admission form.</p>
      <NamedListManager
        rows={rows}
        words={{ title: "Houses", one: "House", placeholder: "Enter house name" }}
        canManage={ctx?.roleCode === "admin"}
        save={saveNamed.bind(null, "houses")}
        remove={removeNamed.bind(null, "houses")}
      />
    </div>
  );
}
