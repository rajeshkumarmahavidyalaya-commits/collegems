import { redirect } from "next/navigation";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import { listEventTypes, listOutbox, listTemplates } from "../actions";
import { DeliveryLog } from "./delivery-log";

export const metadata = { title: "Delivery log" };

export default async function DeliveryLogPage() {
  const canView = await hasPermission("communication.view");
  if (!canView) redirect("/notifications");

  const [outbox, templates, eventTypes, canSend] = await Promise.all([
    listOutbox(undefined, 200),
    listTemplates(),
    listEventTypes(),
    hasPermission("communication.send"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Delivery log</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every message this school has sent, and what became of each copy of it. &ldquo;Did the
            announcement go out&rdquo; and &ldquo;did Ravi&rsquo;s mother get the SMS&rdquo; are
            different questions, and both are answerable here.
          </p>
        </div>
        {canSend && (
          <Button asChild>
            <Link href="/notifications/compose">
              <PenLine className="size-4" aria-hidden="true" />
              Compose
            </Link>
          </Button>
        )}
      </div>

      <DeliveryLog
        outbox={outbox}
        templates={templates}
        eventTypes={eventTypes}
        canManage={canSend}
      />
    </div>
  );
}
