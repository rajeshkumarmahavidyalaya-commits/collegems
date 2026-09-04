import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import { listChannelStatus } from "../actions";
import { ChannelsPanel } from "./channels-panel";

export const metadata = { title: "Notification channels" };

export default async function ChannelsPage() {
  // The queue counts on this screen are the school's, and the settings decide
  // what it spends money on. Both are an administrator's business.
  const canManage = await hasPermission("settings.manage");
  if (!canManage) redirect("/notifications");

  const channels = await listChannelStatus();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification channels</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Whether a message actually leaves the building has three parts: this build has to have a
          driver for the channel, the school has to have turned it on and given it an address, and
          the dispatcher has to have found its credentials. Each channel below says which of those
          is missing.
        </p>
      </div>

      <ChannelsPanel channels={channels} />
    </div>
  );
}
