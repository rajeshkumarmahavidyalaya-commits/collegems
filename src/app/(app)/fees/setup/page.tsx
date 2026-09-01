import Link from "next/link";
import { IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { listSections } from "../../students/actions";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getFeeIntegrationSettings,
  listClassLevels,
  listFeeHeads,
  listFeeStructures,
} from "../actions";
import { FeeSetup } from "./fee-setup";

export const metadata = { title: "Fee setup" };

export default async function FeeSetupPage() {
  const [ctx, feeHeads, structures, classLevels, sections, integrations, canManageSettings] =
    await Promise.all([
      getUserContext(),
      listFeeHeads(),
      listFeeStructures(),
      listClassLevels(),
      listSections(),
      getFeeIntegrationSettings(),
      hasPermission("settings.manage"),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fee setup</h1>
          <p className="text-sm text-muted-foreground">
            What the school charges, what each class pays, and raising the bills — for{" "}
            {ctx?.currentSessionName ?? "the current session"}.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/fees">
            <IndianRupee className="size-4" aria-hidden="true" />
            Collection
          </Link>
        </Button>
      </div>

      <FeeSetup
        feeHeads={feeHeads}
        structures={structures}
        classLevels={classLevels}
        sections={sections}
        integrations={integrations}
        canManageSettings={canManageSettings}
      />
    </div>
  );
}
