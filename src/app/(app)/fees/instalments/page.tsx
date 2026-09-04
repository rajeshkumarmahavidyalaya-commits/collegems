import { getUserContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listSections } from "../../students/actions";
import { listFeeStructures, listInstalments } from "../actions";
import { InstalmentsView } from "./instalments-view";

export const metadata = { title: "Billing periods" };

export default async function InstalmentsPage() {
  const [ctx, canManage, canView] = await Promise.all([
    getUserContext(),
    hasPermission("settings.manage"),
    hasPermission("fees.view"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Billing periods</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ask an administrator to grant you <code className="font-mono">fees.view</code>.
        </p>
      </div>
    );
  }

  const [instalments, sections, structures] = await Promise.all([
    listInstalments(),
    listSections(),
    listFeeStructures(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing periods</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The calendar for {ctx?.currentSessionName ?? "the current session"}. Each period says
          which fees it collects, so a monthly run charges the bus fare without charging the year&apos;s
          tuition again.
        </p>
      </div>

      <InstalmentsView
        instalments={instalments}
        sections={sections}
        usedFrequencies={[...new Set(structures.map((s) => s.frequency))]}
        canManage={canManage}
      />
    </div>
  );
}
