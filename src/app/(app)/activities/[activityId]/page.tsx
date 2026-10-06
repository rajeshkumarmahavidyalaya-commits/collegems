import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { getLocale } from "@/lib/i18n/server";
import { formatCurrency } from "@/lib/i18n/format";
import { getActivity, listActivityParticipants } from "../actions";
import { ActivityParticipants } from "./participants";

export const metadata = { title: "Activity" };

/** One activity and its students. A lookup by id, whatever its year. */
export default async function ActivityPage({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  const [activity, ctx, locale] = await Promise.all([getActivity(activityId), getUserContext(), getLocale()]);
  if (!activity) notFound();
  const rows = await listActivityParticipants(activityId);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={activity.name} icon={Trophy}>
        <Button asChild variant="outline">
          <Link href="/activities">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All activities
          </Link>
        </Button>
      </PageToolbar>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{activity.className ?? "All classes"}</span>
        <span>{activity.fee > 0 ? `${formatCurrency(activity.fee, locale)}${activity.feeHeadName ? ` · ${activity.feeHeadName}` : ""}` : "Free"}</span>
        <Badge variant={activity.isActive ? "success" : "outline"}>{activity.isActive ? "Active" : "Inactive"}</Badge>
      </div>
      {activity.description && <p className="max-w-3xl whitespace-pre-line text-sm">{activity.description}</p>}
      <ActivityParticipants
        activityId={activity.id}
        name={activity.name}
        fee={activity.fee}
        isActive={activity.isActive}
        rows={rows}
        canManage={ctx?.roleCode === "admin"}
      />
    </div>
  );
}
