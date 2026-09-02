import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/context";
import { getTeacherRoutine } from "../actions";
import { WeekView } from "../week-view";

export const metadata = { title: "My week" };

export default async function MyWeekPage() {
  const ctx = await getUserContext();

  // Only a person with a staff record has a teaching week. An accountant
  // landing here should go somewhere useful rather than see an empty grid.
  if (!ctx?.staffId) redirect("/timetable");

  // No id is passed: the RPC resolves the caller's own staff record, so this
  // page cannot be pointed at somebody else by editing a URL.
  const entries = await getTeacherRoutine();

  const periods = entries.length;
  const sections = new Set(entries.map((e) => e.sectionId)).size;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My week</h1>
        <p className="text-sm text-muted-foreground">
          {periods === 0
            ? `Your teaching week for ${ctx.currentSessionName ?? "this session"}.`
            : `${periods} ${periods === 1 ? "period" : "periods"} across ${sections} ${
                sections === 1 ? "class" : "classes"
              }, for ${ctx.currentSessionName ?? "this session"}.`}
        </p>
      </div>

      <WeekView entries={entries} />
    </div>
  );
}
