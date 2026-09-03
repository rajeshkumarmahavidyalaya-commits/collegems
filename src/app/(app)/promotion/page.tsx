import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { listRuns, listSessions } from "./actions";
import { PromotionPlanner } from "./promotion-planner";

export const metadata = { title: "Promotion" };

export default async function PromotionPage() {
  const canManage = await hasPermission("settings.manage");
  if (!canManage) redirect("/");

  const [sessions, runs] = await Promise.all([listSessions(), listRuns()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Promotion</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Moving a whole school up a year. The rules produce a first answer; the preview is a set of
          rows you can change, and applying writes what the rows say — because every year there are
          three or four children the rules get wrong, and the person who knows that is standing at
          this screen.
        </p>
      </div>

      <PromotionPlanner sessions={sessions} runs={runs} />
    </div>
  );
}
