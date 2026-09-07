"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseFields, type SettingField, type SettingType } from "@/lib/validations/settings";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type SettingRow = {
  key: string;
  label: string;
  description: string | null;
  module: string;
  valueType: SettingType;
  fields: SettingField[];
  value: unknown;
  defaultValue: unknown;
  isSet: boolean;
  isRequired: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type SettingProblem = { key: string; severity: string; message: string };

/**
 * Every catalogue key with its effective value. There is no role branch here:
 * `settings` lets any tenant member read, only an administrator write, and the
 * page renders the controls read-only when `settings.manage` is absent.
 */
export async function listSettings(): Promise<SettingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("settings_effective");

  return (data ?? []).map((s) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    module: s.module,
    valueType: s.value_type as SettingType,
    fields: parseFields(s.fields),
    value: s.value,
    defaultValue: s.default_value,
    isSet: Boolean(s.is_set),
    isRequired: Boolean(s.is_required),
    updatedAt: s.updated_at,
    updatedBy: s.updated_by_label,
  }));
}

export async function listSettingProblems(): Promise<SettingProblem[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("settings_problems");
  return (data ?? []).map((p) => ({
    key: p.key ?? "",
    severity: p.severity ?? "info",
    message: p.message ?? "",
  }));
}

/**
 * The value arrives already shaped to the declared JSON type — the form did the
 * conversion, because only the form knows which control produced it. The server
 * still validates: `setting_set` checks the shape against the catalogue and
 * refuses a key nobody declared, which is what keeps this from being the
 * free-form bag it replaced.
 */
export async function saveSetting(key: string, value: unknown): Promise<ActionResult<void>> {
  if (typeof key !== "string" || key === "") {
    return { ok: false, error: "Which setting?" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("setting_set", {
    p_key: key,
    p_value: value as never,
  });

  // Every refusal from that function is already a sentence naming the setting
  // and what it expected.
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/school");
  return { ok: true, data: undefined };
}
