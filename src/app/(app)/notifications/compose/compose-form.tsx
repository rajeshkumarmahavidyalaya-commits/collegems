"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2, Search, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  AUDIENCE_KINDS,
  CHANNELS,
  SECTION_WHO,
  channelSends,
  channelState,
  composeSchema,
  type ChannelStatus,
  type ComposeInput,
} from "@/lib/validations/notifications";
import { previewAudience, sendNotification, type EventType } from "../actions";

type Props = {
  eventTypes: EventType[];
  roles: { code: string; name: string }[];
  sections: { id: string; label: string }[];
  recipients: { id: string; label: string; roleName: string }[];
  channelStatus: ChannelStatus[];
};

export function ComposeForm({
  eventTypes,
  roles,
  sections,
  recipients,
  channelStatus,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reach, setReach] = useState<number | null>(null);
  const [reachPending, setReachPending] = useState(false);
  const [search, setSearch] = useState("");

  const defaultEvent = eventTypes.find((e) => e.key === "general.announcement") ?? eventTypes[0];

  const form = useForm<ComposeInput>({
    resolver: zodResolver(composeSchema),
    defaultValues: {
      eventKey: defaultEvent?.key ?? "",
      subject: "",
      body: "",
      channels: defaultEvent?.defaultChannels?.length
        ? (defaultEvent.defaultChannels as ComposeInput["channels"])
        : ["in_app"],
      audienceKind: "all",
      role: "",
      sectionId: "",
      who: "both",
      userIds: [],
    },
  });

  const values = form.watch();
  const selectedEvent = eventTypes.find((e) => e.key === values.eventKey);

  // Switching event type re-applies that event's default channels. An
  // administrator who has already touched the channel boxes keeps their choice
  // -- silently resetting a deliberate selection is worse than a stale default.
  const channelsTouched = form.formState.dirtyFields.channels;
  const lastEventKey = useRef(values.eventKey);
  useEffect(() => {
    if (values.eventKey === lastEventKey.current) return;
    lastEventKey.current = values.eventKey;
    if (channelsTouched) return;

    const next = eventTypes.find((e) => e.key === values.eventKey);
    if (next?.defaultChannels?.length) {
      form.setValue("channels", next.defaultChannels as ComposeInput["channels"]);
    }
  }, [values.eventKey, channelsTouched, eventTypes, form]);

  // Ask the server how many people this audience is, debounced, whenever the
  // audience changes. Never derived on the client: the answer depends on
  // enrolments and guardian links this page does not have, and a number that
  // disagrees with the send is worse than no number.
  const audienceKey = JSON.stringify({
    kind: values.audienceKind,
    role: values.role,
    sectionId: values.sectionId,
    who: values.who,
    userIds: values.userIds,
  });

  useEffect(() => {
    const parsed = composeSchema.safeParse({ ...form.getValues(), body: "x", eventKey: "x" });
    if (!parsed.success) {
      setReach(null);
      return;
    }

    let cancelled = false;
    setReachPending(true);
    const timer = setTimeout(async () => {
      const result = await previewAudience(parsed.data);
      if (cancelled) return;
      setReach(result.ok ? result.data.count : null);
      setReachPending(false);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setReachPending(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audienceKey]);

  const chosenChannels = values.channels ?? [];
  // Not "has no driver" and not "is switched off" — the whole question, asked
  // once, in the one place that can answer it.
  const queuedOnly = chosenChannels.filter((c) => {
    const status = channelStatus.find((s) => s.channel === c);
    return !status || !channelSends(status);
  });

  const filteredRecipients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return recipients;
    return recipients.filter(
      (r) =>
        r.label.toLowerCase().includes(needle) || r.roleName.toLowerCase().includes(needle),
    );
  }, [recipients, search]);

  function toggleChannel(value: string, checked: boolean) {
    const current = form.getValues("channels") ?? [];
    const next = checked
      ? [...current, value as ComposeInput["channels"][number]]
      : current.filter((c) => c !== value);
    form.setValue("channels", next, { shouldDirty: true, shouldValidate: true });
  }

  function toggleRecipient(id: string, checked: boolean) {
    const current = form.getValues("userIds") ?? [];
    form.setValue(
      "userIds",
      checked ? [...current, id] : current.filter((u) => u !== id),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function onSubmit(input: ComposeInput) {
    startTransition(async () => {
      const result = await sendNotification(input);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof ComposeInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }

      toast.success(
        `Sent to ${result.data.deliveries} ${result.data.deliveries === 1 ? "delivery" : "deliveries"}.`,
      );
      router.push("/notifications/log");
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6" noValidate>
        <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Message</CardTitle>
                <CardDescription>
                  {selectedEvent?.description ??
                    "What kind of message this is decides its default channels and which template renders it."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SelectField
                  control={form.control}
                  name="eventKey"
                  label="Kind of message"
                  required
                  options={eventTypes.map((e) => ({ value: e.key, label: e.name }))}
                />
                <TextField
                  control={form.control}
                  name="subject"
                  label="Subject"
                  description="Shown as the headline in the inbox and as the email subject line."
                />
                <TextareaField
                  control={form.control}
                  name="body"
                  label="Message"
                  required
                  rows={8}
                  description="Plain text. Keep it short if SMS is one of the channels — a long message costs more than one."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Who receives it</CardTitle>
                <CardDescription>
                  Only people with a login can receive a message. A young student with no account
                  is reached through their guardian.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SelectField
                  control={form.control}
                  name="audienceKind"
                  label="Audience"
                  required
                  options={AUDIENCE_KINDS.map((a) => ({ value: a.value, label: a.label }))}
                />

                {values.audienceKind === "role" && (
                  <SelectField
                    control={form.control}
                    name="role"
                    label="Role"
                    required
                    options={roles.map((r) => ({ value: r.code, label: r.name }))}
                  />
                )}

                {values.audienceKind === "section" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SelectField
                      control={form.control}
                      name="sectionId"
                      label="Class"
                      required
                      options={sections.map((s) => ({ value: s.id, label: s.label }))}
                    />
                    <SelectField
                      control={form.control}
                      name="who"
                      label="Send to"
                      required
                      options={SECTION_WHO.map((w) => ({ value: w.value, label: w.label }))}
                    />
                  </div>
                )}

                {values.audienceKind === "users" && (
                  <RecipientPicker
                    recipients={filteredRecipients}
                    total={recipients.length}
                    selected={values.userIds ?? []}
                    search={search}
                    onSearch={setSearch}
                    onToggle={toggleRecipient}
                    error={form.formState.errors.userIds?.message}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Channels</CardTitle>
                <CardDescription>
                  Each channel chosen creates its own delivery row per person, so the log can
                  answer &ldquo;did the SMS arrive&rdquo; separately from &ldquo;did they read
                  it&rdquo;.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <fieldset className="flex flex-col gap-3">
                  <legend className="sr-only">Channels</legend>
                  {CHANNELS.map((channel) => {
                    const checked = chosenChannels.includes(channel.value);
                    const status = channelStatus.find((s) => s.channel === channel.value);
                    const state = status ? channelState(status) : null;
                    return (
                      <div key={channel.value} className="flex items-start gap-3">
                        <Checkbox
                          id={`channel-${channel.value}`}
                          checked={checked}
                          onCheckedChange={(state) => toggleChannel(channel.value, state === true)}
                          aria-describedby={`channel-${channel.value}-note`}
                        />
                        <div className="grid gap-0.5 leading-tight">
                          <Label
                            htmlFor={`channel-${channel.value}`}
                            className="flex flex-wrap items-center gap-1.5"
                          >
                            {channel.label}
                            <Badge
                              variant={state?.kind === "live" ? "default" : "outline"}
                              className="font-normal"
                            >
                              {state?.kind === "live" ? "Delivers now" : "Queues only"}
                            </Badge>
                          </Label>
                          <span
                            id={`channel-${channel.value}-note`}
                            className="text-xs text-muted-foreground"
                          >
                            {state?.sentence ?? channel.note}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </fieldset>

                {form.formState.errors.channels && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.channels.message}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-4" aria-hidden="true" />
                  Reach
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p aria-live="polite" className="text-sm">
                  {reachPending ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Working out who that is…
                    </span>
                  ) : reach === null ? (
                    <span className="text-muted-foreground">
                      Finish choosing an audience to see how many people it reaches.
                    </span>
                  ) : reach === 0 ? (
                    <span className="font-medium text-destructive">
                      Nobody. That audience matches no account, so there is nothing to send.
                    </span>
                  ) : (
                    <span>
                      <span className="font-mono text-2xl font-semibold tabular-nums">{reach}</span>{" "}
                      <span className="text-muted-foreground">
                        {reach === 1 ? "person" : "people"}, ×{" "}
                        {chosenChannels.length || 0}{" "}
                        {chosenChannels.length === 1 ? "channel" : "channels"} ={" "}
                        {reach * (chosenChannels.length || 0)} deliveries
                      </span>
                    </span>
                  )}
                </p>

                {queuedOnly.length > 0 && (
                  <Alert>
                    <Info className="size-4" aria-hidden="true" />
                    <AlertTitle>Nothing leaves the building yet</AlertTitle>
                    <AlertDescription>
                      No provider is connected for{" "}
                      {queuedOnly
                        .map((c) => CHANNELS.find((k) => k.value === c)?.label ?? c)
                        .join(", ")}
                      . Those deliveries are recorded and queued, and will send when a driver is
                      configured — they are not being sent now.
                    </AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={pending || reach === 0} className="w-full">
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                  Send
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </Form>
  );
}

function RecipientPicker({
  recipients,
  total,
  selected,
  search,
  onSearch,
  onToggle,
  error,
}: {
  recipients: { id: string; label: string; roleName: string }[];
  total: number;
  selected: string[];
  search: string;
  onSearch: (value: string) => void;
  onToggle: (id: string, checked: boolean) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="recipient-search">
        People
        <span aria-hidden="true" className="text-destructive"> *</span>
      </Label>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="recipient-search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name or role"
          className="pl-8"
        />
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selected.length} selected · showing {recipients.length} of {total} accounts
      </p>

      <div className="max-h-64 overflow-y-auto rounded-md border">
        {recipients.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {total === 0
              ? "Nobody in this school has a login yet."
              : "No account matches that search."}
          </p>
        ) : (
          <ul className="divide-y">
            {recipients.map((person) => {
              const checked = selected.includes(person.id);
              return (
                <li key={person.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent",
                      checked && "bg-accent/60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(state) => onToggle(person.id, state === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{person.label}</span>
                    {person.roleName && (
                      <Badge variant="outline" className="shrink-0 font-normal">
                        {person.roleName}
                      </Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
