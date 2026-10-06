import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { listExamGroups } from "../group-actions";
import { ExamGroupsView } from "./exam-groups-view";

export const metadata = { title: "Exam groups" };

/**
 * The reference's Exam Groups (0341). Every member of the college may read the
 * list; the administrator writes it, which is the policy on `exam_groups`, so
 * the form is drawn for the administrator alone.
 */
export default async function ExamGroupsPage() {
  const [rows, ctx] = await Promise.all([listExamGroups(), getUserContext()]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Exam Groups" icon={Layers}>
        <Button asChild variant="outline">
          <Link href="/exams">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Manage Exams
          </Link>
        </Button>
      </PageToolbar>
      <p className="max-w-3xl text-sm text-muted-foreground">
        The groups a college files its exams under, such as First Term or Annual. An exam&apos;s group is chosen when the exam is added.
      </p>
      <ExamGroupsView rows={rows} canManage={ctx?.roleCode === "admin"} />
    </div>
  );
}
