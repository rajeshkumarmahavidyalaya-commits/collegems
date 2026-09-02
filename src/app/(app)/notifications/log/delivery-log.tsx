"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportRowsToCsv } from "@/components/data-table/data-table";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  CHANNELS,
  audienceKindLabel,
  channelIsLive,
  channelLabel,
  relativeTime,
  statusLabel,
  templateSchema,
  templateVariables,
  type TemplateInput,
} from "@/lib/validations/notifications";
import {
  deleteTemplate,
  listDeliveries,
  saveTemplate,
  type DeliveryRow,
  type EventType,
  type OutboxRow,
  type TemplateRow,
} from "../actions";

type Props = {
  outbox: OutboxRow[];
  templates: TemplateRow[];
  eventTypes: EventType[];
  canManage: boolean;
};

export function DeliveryLog({ outbox, templates, eventTypes, canManage }: Props) {
  return (
    <Tabs defaultValue="sent">
      <TabsList>
        <TabsTrigger value="sent">Sent</TabsTrigger>
        <TabsTrigger value="templates">Templates</TabsTrigger>
      </TabsList>

      <TabsContent value="sent" className="mt-4">
        <SentTab outbox={outbox} eventTypes={eventTypes} />
      </TabsContent>

      <TabsContent value="templates" className="mt-4">
        <TemplatesTab templates={templates} eventTypes={eventTypes} canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Sent
// ---------------------------------------------------------------------------

function SentTab({ outbox, eventTypes }: { outbox: OutboxRow[]; eventTypes: EventType[] }) {
  const [eventFilter, setEventFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(
    () => (eventFilter === "all" ? outbox : outbox.filter((r) => r.eventKey === eventFilter)),
    [outbox, eventFilter],
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          sent: acc.sent + r.sent,
          queued: acc.queued + r.queued,
          failed: acc.failed + r.failed,
          skipped: acc.skipped + r.skipped,
        }),
        { sent: 0, queued: 0, failed: 0, skipped: 0 },
      ),
    [rows],
  );

  function exportCsv() {
    exportRowsToCsv(
      rows.map((r) => ({
        sent_at: new Date(r.createdAt).toLocaleString("en-IN"),
        event: r.eventName,
        subject: r.subject ?? "",
        audience: describeAudience(r.audience),
        sent_by: r.createdByName ?? "",
        recipients: r.recipients,
        deliveries: r.deliveries,
        delivered: r.sent,
        queued: r.queued,
        failed: r.failed,
        skipped: r.skipped,
      })),
      [
        { key: "sent_at", label: "Sent at" },
        { key: "event", label: "Event" },
        { key: "subject", label: "Subject" },
        { key: "audience", label: "Audience" },
        { key: "sent_by", label: "Sent by" },
        { key: "recipients", label: "Recipients" },
        { key: "deliveries", label: "Deliveries" },
        { key: "delivered", label: "Delivered" },
        { key: "queued", label: "Queued" },
        { key: "failed", label: "Failed" },
        { key: "skipped", label: "Skipped" },
      ],
      `notifications-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="event-filter" className="text-sm text-muted-foreground">
            Event
          </Label>
          <Select value={eventFilter} onValueChange={setEventFilter}>
            <SelectTrigger id="event-filter" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every kind</SelectItem>
              {eventTypes.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="ml-auto"
        >
          <Download className="size-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {totals.queued > 0 && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {totals.queued} {totals.queued === 1 ? "delivery is" : "deliveries are"} waiting on a
            provider
          </AlertTitle>
          <AlertDescription>
            Email, SMS and WhatsApp deliveries are recorded and queued, but no driver is connected
            yet, so nothing has actually been sent on those channels. In-app messages have
            arrived.
          </AlertDescription>
        </Alert>
      )}

      <p aria-live="polite" className="sr-only">
        {rows.length} {rows.length === 1 ? "notification" : "notifications"} listed.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title={eventFilter === "all" ? "Nothing has been sent yet" : "Nothing of that kind yet"}
          description={
            eventFilter === "all"
              ? "Messages sent from this school — by a person or by a module — will be listed here with their delivery outcomes."
              : "No message of that kind has been sent. Change the filter to see everything."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <OutboxCard
              key={row.id}
              row={row}
              isOpen={expanded === row.id}
              onToggle={() => setExpanded((c) => (c === row.id ? null : row.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutboxCard({
  row,
  isOpen,
  onToggle,
}: {
  row: OutboxRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      setDeliveries(await listDeliveries(row.id));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    onToggle();
    // Fetched on first open, not with the list: a school sending to 600 parents
    // would otherwise pull 1,200 delivery rows to render four numbers.
    if (!isOpen && deliveries === null && !loading) void load();
  }

  return (
    <li>
      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={isOpen}
            className="flex w-full flex-col gap-2 rounded-lg p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-normal">
                {row.eventName}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {describeAudience(row.audience)}
              </span>
              <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <time dateTime={row.createdAt} title={new Date(row.createdAt).toLocaleString("en-IN")}>
                  {relativeTime(row.createdAt)}
                </time>
                <ChevronDown
                  className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                  aria-hidden="true"
                />
              </span>
            </div>

            {row.subject && <p className="text-sm font-medium">{row.subject}</p>}
            <p className="line-clamp-2 text-sm text-muted-foreground">{row.body}</p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">
                {row.recipients} {row.recipients === 1 ? "person" : "people"} ·{" "}
                {row.deliveries} {row.deliveries === 1 ? "delivery" : "deliveries"}
              </span>
              <CountChip label="Delivered" count={row.sent} tone="success" />
              <CountChip label="Queued" count={row.queued} tone="muted" />
              <CountChip label="Failed" count={row.failed} tone="danger" />
              <CountChip label="Skipped" count={row.skipped} tone="warning" />
              {row.createdByName && (
                <span className="ml-auto text-muted-foreground">by {row.createdByName}</span>
              )}
            </div>
          </button>

          {isOpen && (
            <div className="border-t px-4 py-3">
              {loading ? (
                <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading deliveries…
                </p>
              ) : loadError ? (
                <div className="flex flex-wrap items-center gap-3 py-4">
                  <p className="text-sm text-destructive">These deliveries could not be loaded.</p>
                  <Button variant="outline" size="sm" onClick={() => void load()}>
                    Try again
                  </Button>
                </div>
              ) : !deliveries?.length ? (
                <p className="py-4 text-sm text-muted-foreground">
                  This message reached nobody — the audience matched no account at the time it was
                  sent.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Sent to</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deliveries.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.recipient}</TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5">
                              {channelLabel(d.channel)}
                              {!channelIsLive(d.channel) && (
                                <Badge variant="outline" className="font-normal">
                                  no provider
                                </Badge>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {d.address ?? "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={d.status} />
                            {d.lastError && (
                              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                {d.lastError}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {d.attempts}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function CountChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "success" | "muted" | "danger" | "warning";
}) {
  if (count === 0) return null;

  // Word plus number, never a bare coloured pill: the colour is a second signal,
  // not the only one.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        tone === "success" && "border-emerald-600/30 text-emerald-700 dark:text-emerald-400",
        tone === "danger" && "border-destructive/40 text-destructive",
        tone === "warning" && "border-amber-600/30 text-amber-700 dark:text-amber-400",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      <span className="font-mono tabular-nums">{count}</span>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "sent"
      ? "default"
      : status === "failed"
        ? "destructive"
        : ("outline" as const);

  return (
    <Badge variant={variant} className="font-normal">
      {statusLabel(status)}
    </Badge>
  );
}

/** "Everyone", "All teachers", "Class 6B — students and parents", "3 people". */
function describeAudience(audience: Record<string, unknown>): string {
  const kind = typeof audience.kind === "string" ? audience.kind : "";

  switch (kind) {
    case "all":
      return "Everyone with a login";
    case "role":
      return `Role: ${String(audience.role ?? "unknown")}`;
    case "section": {
      const who = String(audience.who ?? "both");
      const label =
        who === "students" ? "students" : who === "parents" ? "parents" : "students and parents";
      return `One class — ${label}`;
    }
    case "users": {
      const ids = Array.isArray(audience.user_ids) ? audience.user_ids.length : 0;
      return `${ids} named ${ids === 1 ? "person" : "people"}`;
    }
    default:
      return audienceKindLabel(kind || "unknown");
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function TemplatesTab({
  templates,
  eventTypes,
  canManage,
}: {
  templates: TemplateRow[];
  eventTypes: EventType[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const eventName = (key: string) => eventTypes.find((e) => e.key === key)?.name ?? key;

  function add() {
    setEditing(null);
    setOpen(true);
  }

  function edit(template: TemplateRow) {
    setEditing(template);
    setOpen(true);
  }

  function remove(template: TemplateRow) {
    if (
      !window.confirm(
        `Delete the ${channelLabel(template.channel)} template for "${eventName(template.eventKey)}"? Messages of that kind will fall back to whatever text the sending module supplies.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await deleteTemplate(template.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Template deleted.");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Templates</CardTitle>
            <CardDescription className="max-w-2xl">
              Standing text for the messages modules send on their own — an absence notice, a
              payment receipt. Write <code className="font-mono">{"{{name}}"}</code> where a value
              should be substituted. Without a template, the sending module&rsquo;s own wording is
              used, so these are an override, not a requirement.
            </CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={add}>
              <Plus className="size-4" aria-hidden="true" />
              New template
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No templates yet"
              description="Every message is currently sent with the wording its module supplies. Add a template to override that for one event and channel."
              action={
                canManage ? (
                  <Button variant="outline" size="sm" onClick={add}>
                    <Plus className="size-4" aria-hidden="true" />
                    New template
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Text</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="w-24 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => {
                    const variables = templateVariables(`${t.subject ?? ""} ${t.body}`);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{eventName(t.eventKey)}</TableCell>
                        <TableCell>{channelLabel(t.channel)}</TableCell>
                        <TableCell className="max-w-md">
                          {t.subject && <p className="text-sm font-medium">{t.subject}</p>}
                          <p className="line-clamp-2 text-sm text-muted-foreground">{t.body}</p>
                          {variables.length > 0 && (
                            <p className="mt-1 flex flex-wrap gap-1">
                              {variables.map((v) => (
                                <code
                                  key={v}
                                  className="rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground"
                                >
                                  {v}
                                </code>
                              ))}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.isActive ? "default" : "outline"} className="font-normal">
                            {t.isActive ? "In use" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => edit(t)}
                                aria-label={`Edit the ${channelLabel(t.channel)} template for ${eventName(t.eventKey)}`}
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => remove(t)}
                                disabled={pending}
                                aria-label={`Delete the ${channelLabel(t.channel)} template for ${eventName(t.eventKey)}`}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <TemplateDialog
        open={open}
        onOpenChange={setOpen}
        template={editing}
        eventTypes={eventTypes}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
  eventTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateRow | null;
  eventTypes: EventType[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<TemplateInput>({
    resolver: zodResolver(templateSchema),
    values: {
      eventKey: template?.eventKey ?? eventTypes[0]?.key ?? "",
      channel: (template?.channel ?? "in_app") as TemplateInput["channel"],
      subject: template?.subject ?? "",
      body: template?.body ?? "",
      isActive: template?.isActive ?? true,
    },
  });

  const body = form.watch("body");
  const subject = form.watch("subject");
  const variables = templateVariables(`${subject ?? ""} ${body ?? ""}`);

  function onSubmit(input: TemplateInput) {
    startTransition(async () => {
      const result = await saveTemplate(input, template?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof TemplateInput, { message: messages[0] });
          }
        }
        toast.error(result.error);
        return;
      }

      toast.success(template ? "Template updated." : "Template created.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
          <DialogDescription>
            One template per event per channel. An SMS and an email for the same event are
            different texts, which is why the channel is part of the key.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="eventKey"
                label="Event"
                required
                options={eventTypes.map((e) => ({ value: e.key, label: e.name }))}
              />
              <SelectField
                control={form.control}
                name="channel"
                label="Channel"
                required
                options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
              />
            </div>

            <TextField
              control={form.control}
              name="subject"
              label="Subject"
              description="Ignored by SMS, which has no subject line."
            />
            <TextareaField
              control={form.control}
              name="body"
              label="Body"
              required
              rows={6}
              description="Use {{variable}} for values the sending module supplies."
            />

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium">Variables this template uses</p>
              {variables.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  None yet — this text will be sent exactly as written.
                </p>
              ) : (
                <p className="mt-1 flex flex-wrap gap-1">
                  {variables.map((v) => (
                    <code key={v} className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">
                      {v}
                    </code>
                  ))}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                A variable the sending module does not supply is left in place rather than blanked,
                so a typo is visible in the message instead of silently swallowing the value.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="template-active">In use</Label>
                <p className="text-xs text-muted-foreground">
                  Turn this off to fall back to the sending module&rsquo;s own wording without
                  losing the text.
                </p>
              </div>
              <Switch
                id="template-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) => form.setValue("isActive", checked, { shouldDirty: true })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {template ? "Save changes" : "Create template"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Send;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="rounded-full bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
