"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";


import { useForm } from "react-hook-form";


import { zodResolver } from "@hookform/resolvers/zod";


import { Loader2, Plus, Trash2 } from "lucide-react";

import { toast } from "sonner";


import { Button } from "@/components/ui/button";


import { Input } from "@/components/ui/input";


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


import { Switch } from "@/components/ui/switch";


import { ErrorSummary } from "@/components/forms/error-summary";


import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";


import {
  CHANNELS,
  templateSchema,
  templateVariables,
  type TemplateInput,
} from "@/lib/validations/notifications";

import { saveTemplate, type EventType, type TemplateRow } from "../actions";


/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function TemplateDialog({
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
      providerTemplateName: template?.providerTemplateName ?? "",
      providerTemplateLocale: template?.providerTemplateLocale ?? "en",
      providerTemplateParams: template?.providerTemplateParams ?? [],
    },
  });

  const body = form.watch("body");
  const subject = form.watch("subject");
  const channel = form.watch("channel");
  const variables = templateVariables(`${subject ?? ""} ${body ?? ""}`);
  // WhatsApp is the one channel where the text below is *not* what gets sent.
  const isWhatsApp = channel === "whatsapp";

  function onSubmit(input: TemplateInput) {
    startTransition(async () => {
      const result = await saveTemplate(input, template?.id);
      if (!result.ok) {
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof TemplateInput, {
              message: messages[0],
            });
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
          <DialogTitle>
            {template ? "Edit template" : "New template"}
          </DialogTitle>
          <DialogDescription>
            One template per event per channel. An SMS and an email for the same
            event are different texts, which is why the channel is part of the
            key.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={form.control}
                name="eventKey"
                label="Event"
                required
                options={eventTypes.map((e) => ({
                  value: e.key,
                  label: e.name,
                }))}
              />
              <SelectField
                control={form.control}
                name="channel"
                label="Channel"
                required
                options={CHANNELS.map((c) => ({
                  value: c.value,
                  label: c.label,
                }))}
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
              description={
                isWhatsApp
                  ? "What the delivery log will show. WhatsApp sends Meta's approved copy of the template below, not this text — keep them saying the same thing."
                  : "Use {{variable}} for values the sending module supplies."
              }
            />

            {isWhatsApp && (
              <div className="flex flex-col gap-4 rounded-md border border-dashed p-3">
                <div>
                  <p className="text-sm font-medium">
                    Meta&rsquo;s approved template
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    WhatsApp does not accept free text: outside a conversation
                    the recipient started, only templates registered and
                    approved in advance can be sent. This system never sees that
                    text — it refers to it by name, and fills its placeholders
                    in the order below.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    control={form.control}
                    name="providerTemplateName"
                    label="Template name"
                    description="Exactly as registered with Meta."
                  />
                  <TextField
                    control={form.control}
                    name="providerTemplateLocale"
                    label="Template language"
                    description="Meta stores one copy per language and refuses the wrong code."
                  />
                </div>

                <TemplateParameters
                  value={form.watch("providerTemplateParams") ?? []}
                  variables={variables}
                  onChange={(next: string[]) =>
                    form.setValue("providerTemplateParams", next, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>
            )}

            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium">
                Variables this template uses
              </p>
              {variables.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  None yet — this text will be sent exactly as written.
                </p>
              ) : (
                <p className="mt-1 flex flex-wrap gap-1">
                  {variables.map((v) => (
                    <code
                      key={v}
                      className="rounded bg-background px-1.5 py-0.5 font-mono text-xs"
                    >
                      {v}
                    </code>
                  ))}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                A variable the sending module does not supply is left in place
                rather than blanked, so a typo is visible in the message instead
                of silently swallowing the value.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="template-active">In use</Label>
                <p className="text-xs text-muted-foreground">
                  Turn this off to fall back to the sending module&rsquo;s own
                  wording without losing the text.
                </p>
              </div>
              <Switch
                id="template-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) =>
                  form.setValue("isActive", checked, { shouldDirty: true })
                }
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {template ? "Save changes" : "Create template"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The ordered list of payload keys that fill Meta's {{1}}, {{2}}, {{3}}.
 *
 * Positional, because that is what Meta's API takes — and named here, because
 * `{{2}}` in a configuration screen is unreadable and gets filled in wrong. The
 * variables the body already uses are offered as suggestions, since in practice
 * they are the same values in the same order.
 */
export function TemplateParameters({
  value,
  variables,
  onChange,
}: {
  value: string[];
  variables: string[];
  onChange: (next: string[]) => void;
}) {
  const unused = variables.filter((v) => !value.includes(v));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Placeholders, in order</p>

      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None. If Meta&rsquo;s copy has placeholders, they will arrive empty.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {value.map((key, index) => (
            <li key={index} className="flex items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {`{{${index + 1}}}`}
              </code>
              <Input
                value={key}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onChange(
                    value.map((v, i) => (i === index ? e.target.value : v)),
                  )
                }
                className="h-8 font-mono"
                aria-label={`The value for placeholder ${index + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label={`Remove placeholder ${index + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, ""])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add a placeholder
        </Button>
        {unused.map((v) => (
          <Button
            key={v}
            type="button"
            variant="ghost"
            size="sm"
            className="font-mono text-xs"
            onClick={() => onChange([...value, v])}
          >
            + {v}
          </Button>
        ))}
      </div>
    </div>
  );
}
