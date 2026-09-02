import Link from "next/link";
import { PenLine, ScrollText, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/lib/auth/context";
import { listInbox } from "./actions";
import { NotificationInbox } from "./notification-inbox";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const [ctx, rows] = await Promise.all([getUserContext(), listInbox(false, 100)]);
  const isAdmin = ctx?.roleCode === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Everything the school has sent you. Fee receipts, absence notices and announcements
            all arrive here — and here first, whatever else your school has switched on.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button asChild>
              <Link href="/notifications/compose">
                <PenLine className="size-4" aria-hidden="true" />
                Compose
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button asChild variant="outline">
              <Link href="/notifications/log">
                <ScrollText className="size-4" aria-hidden="true" />
                Delivery log
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/notifications/preferences">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Preferences
            </Link>
          </Button>
        </div>
      </div>

      <NotificationInbox rows={rows} />
    </div>
  );
}
