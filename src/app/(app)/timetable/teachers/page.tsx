import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { getTeacherLoad } from "../actions";
import { TeachingLoad } from "./teaching-load";

export const metadata = { title: "Teaching load" };

export default async function TeachingLoadPage() {
  const canManage = await hasPermission("academics.manage");
  if (!canManage) redirect("/timetable");

  const rows = await getTeacherLoad();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Teaching load</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The routine turned ninety degrees. The class grid cannot show you that one teacher has
          twenty-two periods and another has six — this can.
        </p>
      </div>

      <TeachingLoad rows={rows} />
    </div>
  );
}
