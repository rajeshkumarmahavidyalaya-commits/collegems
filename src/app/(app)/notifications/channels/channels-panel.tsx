"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  PauseCircle,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CHANNELS,
  channelLabel,
  channelState,
  relativeTime,
  type ChannelStatus,
} from "@/lib/validations/notifications";
import { dispatchQueuedNow, retryFailedDeliveries, saveChannelSettings } from "../actions";

/**
 * One card per channel, and every card answers the same question in the same
 * order: can this build send it, has the school turned it on, did the
 * dispatcher find its keys, and how much is waiting.
 *
 * The queue counts are the point of the screen. A channel that is switched off
 * still accumulates deliveries — deliberately, so that connecting a provider in
 * March sends February's reminders rather than losing them — and a school needs
 * to be able to see that number before it decides.
 */
export function ChannelsPanel({ channels }: { channels: ChannelStatus[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const waiting = channels
    .filter((c) => c.channel !== "in_app")
    .reduce((total, c) => total + c.queued, 0);

  function dispatch() {
    startTransition(async () => {
      const result = await dispatchQueuedNow();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { sent, failed, remaining } = result.data;
      toast.success(
        `${sent} sent, ${failed} failed${remaining > 0 ? `, ${remaining} still waiting` : ""}.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {waiting === 0 ? (
            "Nothing is waiting to go out."
          ) : (
            <>
              <span className="font-mono font-medium tabular-nums text-foreground">{waiting}</span>{" "}
              {waiting === 1 ? "message is" : "messages are"} waiting to go out.
            </>
          )}
        </p>
        <Button size="sm" className="ml-auto" onClick={dispatch} disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          Send queued messages now
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {channels.map((channel) => (
          <ChannelCard key={channel.channel} status={channel} />
        ))}
      </div>
    </div>
  );
}

function ChannelCard({ status }: { status: ChannelStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fromAddress, setFromAddress] = useState(status.fromAddress ?? "");
  const [senderName, setSenderName] = useState(status.senderName ?? "");

  const state = channelState(status);
  const meta = CHANNELS.find((c) => c.value === status.channel);
  const configurable = status.channel !== "in_app" && meta?.driver === "built";

  const tone =
    state.kind === "live"
      ? { Icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400", word: "Sending" }
      : state.kind === "unbuilt"
        ? { Icon: CircleSlash, className: "text-muted-foreground", word: "No driver" }
        : { Icon: PauseCircle, className: "text-amber-600 dark:text-amber-400", word: "Holding" };

  function save(isEnabled: boolean) {
    startTransition(async () => {
      const result = await saveChannelSettings({
        channel: status.channel,
        isEnabled,
        fromAddress: fromAddress.trim() || undefined,
        senderName: senderName.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${channelLabel(status.channel)} updated.`);
      router.refresh();
    });
  }

  function retry() {
    startTransition(async () => {
      const result = await retryFailedDeliveries(status.channel);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.requeued === 0
          ? "Nothing needed retrying."
          : `${result.data.requeued} put back in the queue.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {channelLabel(status.channel)}
          {/* The word beside the icon, never colour alone. */}
          <Badge variant="outline" className="font-normal">
            <tone.Icon className={`size-3.5 ${tone.className}`} aria-hidden="true" />
            {tone.word}
          </Badge>
          {status.provider && status.provider !== "none" && (
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {status.provider}
            </span>
          )}
        </CardTitle>
        <CardDescription>{state.sentence}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Waiting" value={status.queued} />
          <Stat label="Failed" value={status.failed} tone={status.failed > 0 ? "bad" : undefined} />
          <Stat label="Sent this week" value={status.sentRecently} />
        </dl>

        {status.queued > 0 && state.kind !== "live" && (
          <Alert>
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>
              {status.queued} {status.queued === 1 ? "message is" : "messages are"} being kept, not
              sent
            </AlertTitle>
            <AlertDescription>
              {status.oldestQueuedAt
                ? `The oldest has been waiting since ${relativeTime(status.oldestQueuedAt)}. Nothing is lost — they go out when this channel can send.`
                : "Nothing is lost — they go out when this channel can send."}
            </AlertDescription>
          </Alert>
        )}

        {configurable && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`from-${status.channel}`}>
                  {status.channel === "sms" ? "Sender number" : "From address"}
                </Label>
                <Input
                  id={`from-${status.channel}`}
                  value={fromAddress}
                  disabled={pending}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder={status.channel === "sms" ? "+911234567890" : "office@school.example"}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`sender-${status.channel}`}>Sender name</Label>
                <Input
                  id={`sender-${status.channel}`}
                  value={senderName}
                  disabled={pending}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="The school's name"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id={`enabled-${status.channel}`}
                  checked={status.isEnabled}
                  disabled={pending}
                  onCheckedChange={(next) => save(next === true)}
                />
                <Label htmlFor={`enabled-${status.channel}`} className="text-sm font-normal">
                  {status.isEnabled ? "On for this school" : "Off for this school"}
                </Label>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={pending}
                onClick={() => save(status.isEnabled)}
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Save sender
              </Button>

              {status.failed > 0 && (
                <Button variant="outline" size="sm" disabled={pending} onClick={retry}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Retry {status.failed} failed
                </Button>
              )}
            </div>
          </div>
        )}

        {status.lastSuccessAt && (
          <p className="text-xs text-muted-foreground">
            Last sent successfully {relativeTime(status.lastSuccessAt)}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "bad";
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`font-mono text-lg tabular-nums ${
          tone === "bad" && value > 0 ? "text-destructive" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
