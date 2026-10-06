import Link from "next/link";
import { ArrowLeft, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { NamedListManager } from "@/components/named-list-manager";
import { getUserContext } from "@/lib/auth/context";
import { listNamed, removeNamed, saveNamed } from "../named-list-actions";

export const metadata = { title: "Subject Types" };

/**
 * The reference's Add New Subject Types (0347): a college's own labels for its
 * subjects. Every member reads the list; the administrator writes it, which is
 * the policy on `subject_types`, so the add form is drawn for them alone.
 * Not the theory/practical kind, which the timetable reads.
 */
export default async function SubjectTypesPage() {
  const [rows, ctx] = await Promise.all([listNamed("subject_types"), getUserContext()]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Subject Types" icon={Tags}>
        <Button asChild variant="outline">
          <Link href="/academics?tab=subjects">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Subjects
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Your own labels for subjects, such as Language or Elective. Each subject&apos;s type is chosen on the subject form.
      </p>
      <NamedListManager
        rows={rows}
        words={{ title: "Subject Types", one: "Subject Type", placeholder: "Enter subject type (Language, Elective)", usedBy: "Subjects" }}
        canManage={ctx?.roleCode === "admin"}
        save={saveNamed.bind(null, "subject_types")}
        remove={removeNamed.bind(null, "subject_types")}
      />
    </div>
  );
}
