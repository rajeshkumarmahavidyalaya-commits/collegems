import { Trophy } from "lucide-react";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { activityOptions, listActivities } from "./actions";
import { ActivitiesView } from "./activities-view";

export const metadata = { title: "Activities" };

/**
 * The reference's SM Activities (0348). The office's list and form; the
 * policy on `activities` decides who writes, and the form is drawn for the
 * administrator alone.
 */
export default async function ActivitiesPage() {
  const [ctx, rows, options] = await Promise.all([getUserContext(), listActivities(), activityOptions()]);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title="Activities" icon={Trophy} />
      <ActivitiesView rows={rows} options={options} canManage={ctx?.roleCode === "admin"} />
    </div>
  );
}
