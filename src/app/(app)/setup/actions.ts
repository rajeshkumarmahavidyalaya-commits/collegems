"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { studentTypeCode } from "@/lib/validations/student-types";
import { schoolProfile } from "@/lib/school/identity";
import type { ActionResult } from "../library/actions";
import { saveStudentType } from "../fees/setup/student-type-actions";

/*
 * The setup wizard (the reference's seven steps). Nothing here is a second
 * write path: classes go through class_level_add, subjects through
 * academics_add_subject and the section_subjects policy, kinds of student
 * through saveStudentType, fees through fee_heads and fee_structures, and
 * settings through setting_set. Every one is gated by its own policy or
 * function, so the wizard can do nothing its caller could not do on the
 * module's own screen.
 */

export type WizardState = {
  sessionName: string | null;
  classes: { id: string; name: string; sections: number; subjects: { id: string; name: string }[] }[];
  subjects: { id: string; name: string }[];
  studentTypes: { id: string; name: string; isActive: boolean }[];
  feeHeads: { id: string; name: string; billOnAdmission: boolean; classesPriced: number }[];
  registration: {
    online: { enabled: boolean; perHour: number; note: string; successMessage: string };
    contactEmail: string;
    phone: string;
    required: Record<string, boolean>;
    slug: string | null;
  };
  /** Whether anybody has saved the registration settings yet. */
  registrationSaved: boolean;
};

async function settingValue(key: string): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("setting_value", { p_key: key });
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

export async function wizardState(): Promise<WizardState> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const session = ctx?.currentSessionId ?? null;
  const [levels, sections, taught, subjects, types, heads, prices, online, required, profile, email, tenant] = await Promise.all([
    supabase.from("class_levels").select("id, name, sequence").order("sequence").order("name"),
    session
      ? supabase.from("sections").select("id, class_level_id").eq("session_id", session)
      : Promise.resolve({ data: [] as { id: string; class_level_id: string }[] }),
    session
      ? supabase.from("section_subjects").select("section_id, subjects ( id, name )").eq("session_id", session)
      : Promise.resolve({ data: [] as { section_id: string; subjects: { id: string; name: string } | null }[] }),
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    supabase.from("student_types").select("id, name, is_active").order("name"),
    supabase.from("fee_heads").select("id, name, bill_on_admission").eq("is_active", true).order("name"),
    session
      ? supabase.from("fee_structures").select("fee_head_id, class_level_id").eq("session_id", session)
      : Promise.resolve({ data: [] as { fee_head_id: string; class_level_id: string }[] }),
    settingValue("admissions.online"),
    settingValue("admissions.required_fields"),
    schoolProfile(),
    supabase.rpc("setting_value", { p_key: "contact_email" }),
    ctx ? supabase.from("tenants").select("slug").eq("id", ctx.tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: saved } = await supabase
    .from("settings")
    .select("key")
    .in("key", ["admissions.online", "admissions.required_fields"]);

  const sectionClass = new Map((sections.data ?? []).map((s) => [s.id, s.class_level_id]));
  const subjectsByClass = new Map<string, Map<string, string>>();
  for (const t of taught.data ?? []) {
    const cls = sectionClass.get(t.section_id);
    if (!cls || !t.subjects) continue;
    const m = subjectsByClass.get(cls) ?? new Map<string, string>();
    m.set(t.subjects.id, t.subjects.name);
    subjectsByClass.set(cls, m);
  }
  const priced = new Map<string, Set<string>>();
  for (const p of prices.data ?? []) {
    const set = priced.get(p.fee_head_id) ?? new Set<string>();
    set.add(p.class_level_id);
    priced.set(p.fee_head_id, set);
  }

  return {
    sessionName: ctx?.currentSessionName ?? null,
    classes: (levels.data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      sections: (sections.data ?? []).filter((s) => s.class_level_id === l.id).length,
      subjects: [...(subjectsByClass.get(l.id) ?? new Map())]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    subjects: subjects.data ?? [],
    studentTypes: (types.data ?? []).map((t) => ({ id: t.id, name: t.name, isActive: t.is_active })),
    feeHeads: (heads.data ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      billOnAdmission: h.bill_on_admission,
      classesPriced: priced.get(h.id)?.size ?? 0,
    })),
    registration: {
      online: {
        enabled: online.enabled === true,
        perHour: typeof online.per_hour === "number" ? online.per_hour : 30,
        note: typeof online.note === "string" ? online.note : "",
        successMessage: typeof online.success_message === "string" ? online.success_message : "",
      },
      contactEmail: typeof email.data === "string" ? email.data : "",
      phone: typeof profile.phone === "string" ? profile.phone : "",
      required: Object.fromEntries(Object.entries(required).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>,
      slug: (tenant.data as { slug?: string } | null)?.slug ?? null,
    },
    registrationSaved: (saved ?? []).length > 0,
  };
}

function refresh() {
  revalidatePath("/setup");
  revalidatePath("/academics");
  revalidatePath("/students/new");
}

/** Step 2: each new class with section A, through class_level_add. */
export async function wizardAddClasses(names: string[]): Promise<ActionResult<{ added: string[]; failed: string[] }>> {
  const list = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n).trim()).filter(Boolean))].slice(0, 60);
  if (!list.length) return { ok: false, error: "Tick or type at least one class." };
  const supabase = await createClient();
  const added: string[] = [];
  const failed: string[] = [];
  for (const name of list) {
    const { error } = await supabase.rpc("class_level_add", { p_name: name, p_sections: ["A"] });
    if (error) {
      failed.push(`${name}: ${error.message}`);
      if (error.code === "42501") break;
    } else added.push(name);
  }
  refresh();
  return { ok: true, data: { added, failed } };
}

function subjectCode(name: string, taken: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let base = words.length > 1 ? words.map((w) => w.slice(0, 3)).join("").slice(0, 8) : (words[0] ?? "SUB").slice(0, 8);
  if (base.length < 2) base = `SUB${base}`;
  let code = base;
  for (let i = 2; taken.has(code); i++) code = `${base.slice(0, 6)}${i}`;
  return code;
}

/**
 * Step 3: a subject taught in some classes. A new name becomes a subject
 * through academics_add_subject (one transaction with its classes); a name
 * the college already has is added to the classes that lack it.
 */
export async function wizardAddSubject(
  name: string,
  classLevelIds: string[],
): Promise<ActionResult<{ classes: number }>> {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 1 || clean.length > 100) return { ok: false, error: "Give the subject a name." };
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return { ok: false, error: "There is no current academic year. Set one under Academic years first." };
  const ids = (Array.isArray(classLevelIds) ? classLevelIds : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const supabase = await createClient();
  const { data: sections } = await supabase
    .from("sections")
    .select("id")
    .eq("session_id", ctx.currentSessionId)
    .in("class_level_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (!sectionIds.length) return { ok: false, error: "Those classes have no section this year, so there is nobody to teach it to." };

  const { data: all } = await supabase.from("subjects").select("id, name, code");
  const existing = (all ?? []).find((s) => s.name.toLowerCase() === clean.toLowerCase());
  if (!existing) {
    const code = subjectCode(clean, new Set((all ?? []).map((s) => s.code.toUpperCase())));
    const { error } = await supabase.rpc("academics_add_subject", {
      p_name: clean,
      p_code: code,
      p_kind: "theory",
      p_is_active: true,
      p_section_ids: sectionIds,
    });
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, data: { classes: ids.length } };
  }

  const { data: have } = await supabase
    .from("section_subjects")
    .select("section_id")
    .eq("session_id", ctx.currentSessionId)
    .eq("subject_id", existing.id)
    .in("section_id", sectionIds);
  const already = new Set((have ?? []).map((h) => h.section_id));
  const missing = sectionIds.filter((id) => !already.has(id));
  if (!missing.length) return { ok: false, error: `${existing.name} is already taught in ${ids.length === 1 ? "that class" : "those classes"}.` };
  const { data, error } = await supabase
    .from("section_subjects")
    .insert(missing.map((section_id) => ({
      tenant_id: ctx.tenantId,
      session_id: ctx.currentSessionId as string,
      section_id,
      subject_id: existing.id,
    })))
    .select("id");
  if (error) return { ok: false, error: error.code === "42501" ? "Only an administrator can set what a class studies." : error.message };
  if (!data?.length) return { ok: false, error: "Only an administrator can set what a class studies." };
  refresh();
  return { ok: true, data: { classes: ids.length } };
}

/** Step 3: take a subject off one class this year. Refused once it has marks or a timetable. */
export async function wizardRemoveSubject(subjectId: string, classLevelId: string): Promise<ActionResult> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return { ok: false, error: "No current academic year." };
  const supabase = await createClient();
  const { data: sections } = await supabase
    .from("sections")
    .select("id")
    .eq("session_id", ctx.currentSessionId)
    .eq("class_level_id", classLevelId);
  const { data, error } = await supabase
    .from("section_subjects")
    .delete()
    .eq("subject_id", subjectId)
    .eq("session_id", ctx.currentSessionId)
    .in("section_id", (sections ?? []).map((s) => s.id))
    .select("id");
  if (error) {
    return {
      ok: false,
      error: error.code === "23503" ? "This subject already has a timetable or marks in this class, so it stays. Change it under Subjects." : error.message,
    };
  }
  if (!data?.length) return { ok: false, error: "Only an administrator can change what a class studies." };
  refresh();
  return { ok: true, data: undefined };
}

/** Step 4: new kinds of student, through the fee setup's own action. */
export async function wizardAddStudentTypes(names: string[]): Promise<ActionResult<{ added: string[]; failed: string[] }>> {
  const list = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n).trim()).filter((n) => n.length >= 2))].slice(0, 30);
  if (!list.length) return { ok: false, error: "Type at least one kind of student, of two letters or more." };
  const added: string[] = [];
  const failed: string[] = [];
  for (const name of list) {
    const r = await saveStudentType({ name });
    if (r.ok) added.push(name);
    else failed.push(`${name}: ${r.error}`);
  }
  refresh();
  revalidatePath("/students/types");
  return { ok: true, data: { added, failed } };
}

const CATEGORY: [RegExp, string][] = [
  [/tuition|course|semester|college/i, "tuition"],
  [/transport|bus|van/i, "transport"],
  [/hostel|mess|boarding/i, "hostel"],
  [/exam|test|board/i, "exam"],
  [/library|book/i, "library"],
  [/sport|activit|club|annual day|computer|lab/i, "activity"],
];

/**
 * Step 5: fee types. Each becomes a fee head; an amount above zero becomes
 * that head's amount for every class this year (fee_structures), which is
 * what "Tuition Fee ₹5,000" means on the reference. Frequency is the one the
 * office chose.
 */
export async function wizardAddFeeTypes(
  items: { name: string; amount: number; frequency: string }[],
): Promise<ActionResult<{ added: string[]; failed: string[] }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const rows = (Array.isArray(items) ? items : [])
    .map((i) => ({
      name: String(i?.name ?? "").trim().replace(/\s+/g, " "),
      amount: Number(i?.amount ?? 0),
      frequency: ["one_time", "monthly", "quarterly", "annual"].includes(i?.frequency) ? i.frequency : "annual",
    }))
    .filter((i) => i.name.length >= 2 && Number.isFinite(i.amount) && i.amount >= 0 && i.amount <= 10_000_000)
    .slice(0, 30);
  if (!rows.length) return { ok: false, error: "Add at least one fee type with a name." };

  const supabase = await createClient();
  const [{ data: heads }, { data: levels }] = await Promise.all([
    supabase.from("fee_heads").select("id, name, code"),
    supabase.from("class_levels").select("id"),
  ]);
  const codes = new Set((heads ?? []).map((h) => h.code.toUpperCase()));
  const added: string[] = [];
  const failed: string[] = [];

  for (const item of rows) {
    let headId = (heads ?? []).find((h) => h.name.toLowerCase() === item.name.toLowerCase())?.id ?? null;
    if (!headId) {
      let code = studentTypeCode(item.name).toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 16) || "FEE";
      const base = code;
      for (let n = 2; codes.has(code); n++) code = `${base.slice(0, 14)}${n}`;
      codes.add(code);
      const category = CATEGORY.find(([re]) => re.test(item.name))?.[1] ?? "other";
      const { data, error } = await supabase
        .from("fee_heads")
        .insert({ tenant_id: ctx.tenantId, code, name: item.name, category, is_active: true })
        .select("id")
        .single();
      if (error) {
        failed.push(`${item.name}: ${error.code === "42501" ? "only an administrator or an accountant can add fee types" : error.message}`);
        continue;
      }
      headId = data.id;
    }
    if (item.amount > 0 && ctx.currentSessionId && levels?.length) {
      const { error } = await supabase.from("fee_structures").upsert(
        levels.map((l) => ({
          tenant_id: ctx.tenantId,
          session_id: ctx.currentSessionId as string,
          class_level_id: l.id,
          fee_head_id: headId as string,
          amount: item.amount,
          frequency: item.frequency,
          student_type_id: null,
        })),
        { onConflict: "tenant_id,session_id,class_level_id,fee_head_id,student_type_id" },
      );
      if (error) {
        failed.push(`${item.name}: added, but the amount was not set (${error.message})`);
        continue;
      }
    }
    added.push(item.name);
  }
  refresh();
  revalidatePath("/fees/setup");
  return { ok: true, data: { added, failed } };
}

/** Step 6: registration settings, each through setting_set or the fee head's own switch. */
export async function wizardSaveRegistration(input: {
  online: { enabled: boolean; perHour: number; note: string; successMessage: string };
  contactEmail: string;
  phone: string;
  required: Record<string, boolean>;
  billOnAdmission: Record<string, boolean>;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const problems: string[] = [];
  const set = async (key: string, value: unknown) => {
    const { error } = await supabase.rpc("setting_set", { p_key: key, p_value: value as never });
    if (error) problems.push(error.message);
  };

  const perHour = Math.max(1, Math.min(1000, Math.round(Number(input.online.perHour) || 30)));
  await set("admissions.online", {
    enabled: input.online.enabled === true,
    per_hour: perHour,
    note: input.online.note.trim() || null,
    success_message: input.online.successMessage.trim() || null,
  });
  const required = Object.fromEntries(Object.entries(input.required ?? {}).map(([k, v]) => [k, v === true]));
  await set("admissions.required_fields", required);
  const email = input.contactEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("The notification email does not look like an address.");
  else if (email) await set("contact_email", email);

  // The phone lives in the school profile; keep its other lines as they are.
  const current = await schoolProfile();
  await set("school.profile", { ...current, phone: input.phone.trim() || null });

  for (const [id, on] of Object.entries(input.billOnAdmission ?? {})) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    const { data, error } = await supabase.from("fee_heads").update({ bill_on_admission: on === true }).eq("id", id).select("id");
    if (error) problems.push(error.message);
    else if (!data?.length) problems.push("Only an administrator or an accountant can change which fees are billed at admission.");
  }

  refresh();
  revalidatePath("/settings/school");
  if (problems.length) return { ok: false, error: [...new Set(problems)].join(" ") };
  return { ok: true, data: undefined };
}
