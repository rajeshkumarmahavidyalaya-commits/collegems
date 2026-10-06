import Link from "next/link";
import { ArrowLeft, DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { hasPermission } from "@/lib/auth/permissions";
import { listGatePasses } from "../gate-pass-actions";
import { GatePassesView } from "./gate-passes-view";

export const metadata = { title: "Gate passes" };

/**
 * The reference's SM Gate Pass (0342). Gated as the front office is: the
 * visitor log is the office's, and `visitors` admits nobody else.
 */
export default async function GatePassesPage() {
  const [canView, canManage] = await Promise.all([
    hasPermission("frontoffice.view"),
    hasPermission("frontoffice.manage"),
  ]);
  const toolbar = (
    <PageToolbar title="Gate Passes" icon={DoorOpen}>
      <Button asChild variant="outline">
        <Link href="/front-office">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Front office
        </Link>
      </Button>
    </PageToolbar>
  );
  if (!canView) {
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <p className="max-w-2xl text-sm text-muted-foreground">
          Gate passes are kept by the front office, which needs <code className="font-mono">frontoffice.view</code>.
        </p>
      </div>
    );
  }
  const rows = await listGatePasses();
  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      <GatePassesView rows={rows} canManage={canManage} />
    </div>
  );
}
