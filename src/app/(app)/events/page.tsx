import { CalendarHeart } from "lucide-react";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { listMyChildren } from "@/lib/auth/family";
import { schoolToday } from "@/lib/validations/homework-display";
import { listEvents, myParticipations } from "./actions";
import { EventsView } from "./events-view";
import { FamilyEvents } from "./family-events";

export const metadata = { title: "Events" };

/**
 * The reference's Events (0343). One address, two screens, chosen by the tier
 * (rule 4: a tier decides what a person is shown, never what they may do):
 * the office's list and form, or a family's coming events with their own
 * children. The policies and `event_join` decide what each may change.
 */
export default async function EventsPage() {
  const ctx = await getUserContext();
  const toolbar = <PageToolbar title="Events" icon={CalendarHeart} />;

  if (ctx?.roleTier === "student") {
    // Where the school is, not where the server is: an event today is still
    // open at 01:00 in India, which is the evening before in UTC.
    const today = schoolToday();
    const [events, children, parts] = await Promise.all([listEvents(), listMyChildren(), myParticipations()]);
    return (
      <div className="flex flex-col gap-4">
        {toolbar}
        <FamilyEvents
          events={events.filter((e) => e.isActive && e.eventDate >= today).sort((a, b) => (a.eventDate < b.eventDate ? -1 : 1))}
          childrenOf={children.map((c) => ({ id: c.studentId, name: c.name }))}
          taking={parts.map((p) => `${p.eventId}:${p.studentId}`)}
        />
      </div>
    );
  }

  const rows = await listEvents();
  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      <EventsView rows={rows} canManage={ctx?.roleCode === "admin"} />
    </div>
  );
}
