import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarHeart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageToolbar } from "@/components/page-toolbar";
import { getUserContext } from "@/lib/auth/context";
import { getLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/i18n/format";
import { getEvent, listParticipants } from "../actions";
import { Participants } from "./participants";

export const metadata = { title: "Event" };

/** One event and who is taking part. A lookup by id, whatever its year. */
export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const [event, ctx, locale] = await Promise.all([getEvent(eventId), getUserContext(), getLocale()]);
  if (!event) notFound();
  const rows = await listParticipants(eventId);
  return (
    <div className="flex flex-col gap-4">
      <PageToolbar title={event.title} icon={CalendarHeart}>
        <Button asChild variant="outline">
          <Link href="/events">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All events
          </Link>
        </Button>
      </PageToolbar>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{formatDate(event.eventDate, locale)}</span>
        <Badge variant={event.isActive ? "success" : "outline"}>{event.isActive ? "Active" : "Inactive"}</Badge>
      </div>
      {event.description && <p className="max-w-3xl whitespace-pre-line text-sm">{event.description}</p>}
      <Participants eventId={event.id} title={event.title} rows={rows} canManage={ctx?.roleCode === "admin"} />
    </div>
  );
}
