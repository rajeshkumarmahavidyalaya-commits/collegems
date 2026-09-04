"use client";

import { useOptimistic, useTransition } from "react";
import { Info, Lock } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  CHANNELS,
  channelLabel,
  channelState,
  type ChannelStatus,
} from "@/lib/validations/notifications";
import { setPreference, type EventType, type PreferenceRow } from "../actions";

type Props = {
  eventTypes: EventType[];
  preferences: PreferenceRow[];
  channelStatus: ChannelStatus[];
};

/**
 * A grid of event × channel switches, where the *stored* state is only the
 * opt-outs. A switch that is on has no row behind it, which is what lets a
 * school change a default later and have it actually reach people who never
 * touched this page.
 *
 * In-app is deliberately not switchable. It is the channel that always works
 * and the only record a person has of what they were told; letting somebody
 * turn it off would mean a fee reminder with nowhere to land.
 */
export function PreferenceGrid({ eventTypes, preferences, channelStatus }: Props) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    preferences,
    (state: PreferenceRow[], next: PreferenceRow) => [
      ...state.filter((p) => !(p.eventKey === next.eventKey && p.channel === next.channel)),
      next,
    ],
  );

  function isEnabled(eventKey: string, channel: string) {
    const stored = optimistic.find((p) => p.eventKey === eventKey && p.channel === channel);
    return stored ? stored.enabled : true;
  }

  function toggle(eventKey: string, channel: string, enabled: boolean) {
    startTransition(async () => {
      setOptimistic({ eventKey, channel, enabled });
      const result = await setPreference({ eventKey, channel, enabled });
      if (!result.ok) toast.error(result.error);
    });
  }

  const switchable = CHANNELS.filter((c) => c.value !== "in_app");

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>These are yours alone</AlertTitle>
        <AlertDescription>
          No administrator can change them for you. A school that wants everybody on SMS changes
          its own default, which only affects people who have not made a choice here.
        </AlertDescription>
      </Alert>

      {eventTypes.map((event) => (
        <Card key={event.key}>
          <CardHeader>
            <CardTitle className="text-base">{event.name}</CardTitle>
            <CardDescription>{event.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 rounded-md border border-dashed px-3 py-2">
              <div className="flex items-center gap-2">
                <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm">In-app</span>
                <Badge variant="outline" className="font-normal">
                  Always on
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">
                Your inbox is the record of what you were told.
              </span>
            </div>

            {switchable.map((channel) => {
              const inDefault = event.defaultChannels.includes(channel.value);
              const enabled = isEnabled(event.key, channel.value);
              const id = `pref-${event.key}-${channel.value}`;

              return (
                <div key={channel.value} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <label htmlFor={id} className="text-sm font-medium">
                      {channelLabel(channel.value)}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {inDefault
                        ? "Your school sends this one by default."
                        : "Your school does not currently send this one."}
                      {/* The school's real state, not a constant: "SMS is on
                          for you" is worth nothing if the school has not
                          connected a gateway, and a preference screen that
                          does not say so is the surface rule 10 warns about. */}
                      {(() => {
                        const status = channelStatus.find((s) => s.channel === channel.value);
                        const state = status ? channelState(status) : null;
                        return state && state.kind !== "live" ? ` ${state.sentence}` : null;
                      })()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* The word, not just the switch position: a toggle read
                        aloud without a state word is ambiguous. */}
                    <span className="w-16 text-right text-xs text-muted-foreground">
                      {enabled ? "Allowed" : "Muted"}
                    </span>
                    <Switch
                      id={id}
                      checked={enabled}
                      disabled={pending}
                      onCheckedChange={(checked) => toggle(event.key, channel.value, checked)}
                      aria-label={`${channelLabel(channel.value)} for ${event.name}`}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
