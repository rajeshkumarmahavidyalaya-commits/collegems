"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  inputType,
  originSentence,
  toFormValue,
  toJsonValue,
  type SettingType,
} from "@/lib/validations/settings";
import { saveSetting, type SettingRow } from "./actions";

export function SettingsList({
  settings,
  canManage,
}: {
  settings: SettingRow[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {settings.map((setting) => (
        <SettingCard key={setting.key} setting={setting} canManage={canManage} />
      ))}
    </div>
  );
}

/**
 * One card per setting, its controls built from the declared shape.
 *
 * An `object` setting becomes one input per declared field; everything else is
 * a single input. That is the whole rendering rule — there is no branch on a
 * particular key, which is what keeps a new setting to one row in a migration.
 */
function SettingCard({ setting, canManage }: { setting: SettingRow; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const initial = initialDraft(setting);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const dirty = Object.keys(initial).some((k) => initial[k] !== draft[k]);

  function save() {
    startTransition(async () => {
      const result = await saveSetting(setting.key, buildValue(setting, draft));
      if (result.ok) {
        toast.success(`${setting.label} saved.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {setting.label}
          {setting.isRequired && !setting.isSet && <Badge variant="warning">Needed</Badge>}
          {!setting.isSet && !setting.isRequired && <Badge variant="outline">Default</Badge>}
        </CardTitle>
        {setting.description && <CardDescription>{setting.description}</CardDescription>}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {setting.valueType === "object" ? (
            setting.fields.map((field) => (
              <Field
                key={field.name}
                id={`${setting.key}-${field.name}`}
                label={field.label}
                type={field.type}
                value={draft[field.name] ?? ""}
                disabled={!canManage || pending}
                onChange={(v) => setDraft((d) => ({ ...d, [field.name]: v }))}
              />
            ))
          ) : (
            <Field
              id={setting.key}
              label={setting.label}
              type={setting.valueType}
              value={draft.value ?? ""}
              disabled={!canManage || pending}
              onChange={(v) => setDraft({ value: v })}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {originSentence({
              isSet: setting.isSet,
              updatedAt: setting.updatedAt,
              updatedBy: setting.updatedBy,
            })}
          </p>

          {canManage && (
            <div className="flex items-center gap-2">
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(initial)} disabled={pending}>
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Undo
                </Button>
              )}
              <Button size="sm" onClick={save} disabled={pending || !dirty}>
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-3.5" aria-hidden="true" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  type,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  type: SettingType;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (type === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Select value={value || "false"} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={inputType(type)}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function initialDraft(setting: SettingRow): Record<string, string> {
  if (setting.valueType !== "object") {
    return { value: toFormValue(setting.value) };
  }
  const stored = (setting.value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(setting.fields.map((f) => [f.name, toFormValue(stored[f.name])]));
}

/**
 * An empty box means **null**, not `""`. Storing an empty string would make
 * `settings_problems()` count the setting as filled in, and a school would stop
 * being told that its certificates are about to print a blank address.
 */
function buildValue(setting: SettingRow, draft: Record<string, string>): unknown {
  if (setting.valueType !== "object") {
    return toJsonValue(draft.value ?? "", setting.valueType);
  }
  return Object.fromEntries(
    setting.fields.map((f) => [f.name, toJsonValue(draft[f.name] ?? "", f.type)]),
  );
}
