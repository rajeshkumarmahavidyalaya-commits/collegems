"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarHeart, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";
import { joinEvent, leaveEvent, type EventRow } from "./actions";

/**
 * A family's events: the college's active events from today on, each with the
 * family's children and whether each is taking part. Joining and leaving go
 * through `event_join` / `event_leave`, which check the child is the caller's
 * own and the event is open -- the buttons are a convenience, not the gate.
 */
export function FamilyEvents({
  events,
  childrenOf,
  taking,
}: {
  events: EventRow[];
  childrenOf: { id: string; name: string }[];
  /** "eventId:studentId" for every child already on an event. */
  taking: string[];
}) {
  const { formatDate } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const on = new Set(taking);

  function toggle(event: EventRow, child: { id: string; name: string }, joined: boolean) {
    start(async () => {
      const r = joined ? await leaveEvent(event.id, child.id) : await joinEvent(event.id, child.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(joined ? `${child.name} is off "${event.title}".` : `${child.name} is on "${event.title}".`);
      router.refresh();
    });
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-6 py-10 text-center">
        <CalendarHeart className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">No events coming up.</p>
        <p className="text-sm text-muted-foreground">When the college adds one, it appears here and on the school calendar.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((ev) => (
        <li key={ev.id} className="rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{ev.title}</h2>
            <span className="text-sm text-muted-foreground">{formatDate(ev.eventDate)}</span>
          </div>
          {ev.description && <p className="mt-1 whitespace-pre-line text-sm">{ev.description}</p>}
          {childrenOf.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
              {childrenOf.map((child) => {
                const joined = on.has(`${ev.id}:${child.id}`);
                return (
                  <li key={child.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      {child.name}
                      {joined && (
                        <Badge variant="success">
                          <Check className="size-3" aria-hidden="true" />
                          Taking part
                        </Badge>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant={joined ? "outline" : "default"}
                      disabled={pending}
                      onClick={() => toggle(ev, child, joined)}
                    >
                      {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      {joined ? "Take off" : "Take part"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
