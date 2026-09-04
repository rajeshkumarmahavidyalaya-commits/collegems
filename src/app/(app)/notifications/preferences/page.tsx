import { listChannelStatus, listEventTypes, listPreferences } from "../actions";
import { PreferenceGrid } from "./preference-grid";

export const metadata = { title: "Notification preferences" };

export default async function PreferencesPage() {
  const [eventTypes, preferences, channelStatus] = await Promise.all([
    listEventTypes(),
    listPreferences(),
    listChannelStatus(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification preferences</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Which of these reach you, and how. Muting a channel stops it for you only — it does not
          stop the school sending the message, and it never stops your inbox.
        </p>
      </div>

      <PreferenceGrid
        eventTypes={eventTypes}
        preferences={preferences}
        channelStatus={channelStatus}
      />
    </div>
  );
}
