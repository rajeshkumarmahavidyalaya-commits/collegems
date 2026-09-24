import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listElectiveGroups, listElectiveInputs } from "./actions";
import { ElectivesManager } from "./electives-manager";

export const metadata = { title: "Elective subjects" };

/**
 * The office's half of elective choice (0282). Gated on `academics.manage`,
 * and for a second reason than the buttons: `subject_group_overview()` is an
 * invoker, so its "how many have chosen" is only true for a caller who can read
 * every enrolment. A teacher would be shown a smaller, plausible number.
 */
export default async function ElectivesPage() {
  const [ctx, canManage] = await Promise.all([getUserContext(), hasPermission("academics.manage")]);
  if (!ctx) redirect("/login");
  if (!canManage) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Elective subjects</h1>
        <p className="text-sm text-muted-foreground">
          Your role does not set up elective choices. Students see their own on My subjects.
        </p>
      </div>
    );
  }

  const [groups, inputs] = await Promise.all([listElectiveGroups(), listElectiveInputs()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Elective subjects</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Allot a set of subjects to a class for {ctx.currentSessionName ?? "this year"} and say how many each
          student picks. Students choose on their own login and see only what is allotted to their class.
          A choice is created closed; open it when choices are due.
        </p>
      </div>
      <ElectivesManager groups={groups} classLevels={inputs.classLevels} subjects={inputs.subjects} />
    </div>
  );
}
