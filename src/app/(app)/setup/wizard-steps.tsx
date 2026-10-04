"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bed,
  Briefcase,
  Bus,
  Check,
  CheckCheck,
  Globe,
  GraduationCap,
  Info,
  Laptop,
  Lightbulb,
  ListChecks,
  Loader2,
  Plus,
  Settings,
  Sun,
  Trash2,
  Trophy,
  User,
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  wizardAddClasses,
  wizardAddFeeTypes,
  wizardAddStudentTypes,
  wizardAddSubject,
  wizardRemoveSubject,
  wizardSaveRegistration,
  type WizardState,
} from "./actions";

type Nav = { prev: string | null; next: string | null };

/**
 * Previous and Next under every step. Next on a step with something unsaved
 * saves it first and moves on only if that worked -- a wizard that moves on
 * while the save failed is how a school comes to believe its classes exist.
 */
function Footer({ prev, next, onNext, pending, nextLabel = "Next" }: Nav & { onNext?: () => Promise<boolean>; pending?: boolean; nextLabel?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-6 py-4">
      {prev ? (
        <Button asChild variant="outline" size="lg">
          <Link href={prev}>
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
            Previous
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button
          size="lg"
          disabled={busy || pending}
          onClick={() =>
            start(async () => {
              if (onNext && !(await onNext())) return;
              router.push(next);
              router.refresh();
            })
          }
        >
          {busy || pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {nextLabel}
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-xl text-brand-accent">
      <Icon className="size-5" aria-hidden="true" />
      {children}
    </h3>
  );
}

function reportList(added: string[], failed: string[], noun: [string, string]) {
  if (added.length) toast.success(`Added ${added.length} ${added.length === 1 ? noun[0] : noun[1]}: ${added.join(", ")}.`);
  if (failed.length) toast.error(failed.join(" "));
}

// ------------------------------------------------------------------ classes

const SCHOOL_CLASSES = ["Nursery", "LKG", "UKG", ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`)];
const COLLEGE_CLASSES = [
  "B.A. I Year", "B.A. II Year", "B.A. III Year",
  "B.Com I Year", "B.Com II Year", "B.Com III Year",
  "B.Sc I Year", "B.Sc II Year", "B.Sc III Year",
  "B.Ed I Year", "B.Ed II Year",
  "M.A. I Year", "M.A. II Year", "M.Com I Year", "M.Com II Year",
];

export function ClassesStep({ classes, prev, next }: { classes: WizardState["classes"] } & Nav) {
  const have = useMemo(() => new Set(classes.map((c) => c.name.toLowerCase())), [classes]);
  const [custom, setCustom] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const offered = [...SCHOOL_CLASSES, ...COLLEGE_CLASSES, ...custom].filter((n) => !have.has(n.toLowerCase()));

  function toggle(name: string, on: boolean) {
    setChosen((s) => {
      const n = new Set(s);
      if (on) n.add(name);
      else n.delete(name);
      return n;
    });
  }

  async function save(): Promise<boolean> {
    if (!chosen.size) {
      if (classes.length) return true;
      toast.error("Choose at least one class, or type your own.");
      return false;
    }
    const r = await wizardAddClasses([...chosen]);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    reportList(r.data.added, r.data.failed, ["class", "classes"]);
    if (r.data.added.length) setChosen(new Set());
    return r.data.failed.length === 0;
  }

  const box = (name: string, opts: { checked: boolean; disabled?: boolean }) => (
    <label
      key={name}
      className={`flex min-h-14 items-center gap-3 rounded-md border px-4 py-3 ${opts.disabled ? "bg-muted/40" : "cursor-pointer hover:bg-muted/30"}`}
    >
      <Checkbox
        checked={opts.checked}
        disabled={opts.disabled}
        onCheckedChange={(v) => toggle(name, v === true)}
        aria-label={name}
      />
      <span className="min-w-0">
        <span className="block">{name}</span>
        {opts.disabled && <span className="block text-xs text-muted-foreground">Already in your school</span>}
      </span>
    </label>
  );

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <SectionTitle icon={Laptop}>Select Classes for Your School</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Choose which classes your school offers. Each is created with section A for this year; add
          more sections later under Manage Classes.
        </p>
        {classes.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Your classes</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {classes.map((c) => box(c.name, { checked: true, disabled: true }))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-medium">Add classes</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {offered.map((n) => box(n, { checked: chosen.has(n) }))}
          </div>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = typed.trim();
            if (!name) return;
            if (have.has(name.toLowerCase())) return void toast.error(`${name} is already a class.`);
            setCustom((c) => (c.includes(name) ? c : [...c, name]));
            toggle(name, true);
            setTyped("");
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="wiz-class">Another class</Label>
            <Input id="wiz-class" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={60} placeholder="e.g. BCA I Year" />
          </div>
          <Button type="submit" variant="outline">
            <Plus className="size-4" aria-hidden="true" />
            Add to list
          </Button>
        </form>
        <div className="rounded-md bg-muted/40 p-4">
          <p className="mb-2">Quick Selection:</p>
          <div className="inline-flex overflow-hidden rounded-md border">
            <button type="button" className="flex items-center gap-1.5 border-e px-4 py-2 text-sm text-brand-accent hover:bg-muted" onClick={() => setChosen(new Set(offered))}>
              <CheckCheck className="size-4" aria-hidden="true" /> Select All
            </button>
            <button type="button" className="flex items-center gap-1.5 px-4 py-2 text-sm hover:bg-muted" onClick={() => setChosen(new Set())}>
              <X className="size-4" aria-hidden="true" /> Clear All
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
            {chosen.size} selected to add.
          </p>
        </div>
      </div>
      <Footer prev={prev} next={next} onNext={save} nextLabel={chosen.size ? `Save ${chosen.size} and continue` : "Next"} />
    </>
  );
}

// ----------------------------------------------------------------- subjects

const COMMON_SUBJECTS = ["Mathematics", "English", "Hindi", "Science", "Social Studies", "Physical Education", "Computer Science"];
const MORE_SUBJECTS = [
  "Sanskrit", "Physics", "Chemistry", "Biology", "History", "Geography", "Political Science",
  "Economics", "Sociology", "Psychology", "Accountancy", "Business Studies", "Environmental Studies", "Art",
];

export function SubjectsStep({ classes, prev, next }: { classes: WizardState["classes"] } & Nav) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const taught = classes.filter((c) => c.sections > 0);

  function add(name: string, classIds: string[]) {
    start(async () => {
      const r = await wizardAddSubject(name, classIds);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${name} added to ${classIds.length === 1 ? "the class" : `${classIds.length} classes`}.`);
      router.refresh();
    });
  }
  function remove(subjectId: string, name: string, classId: string) {
    start(async () => {
      const r = await wizardRemoveSubject(subjectId, classId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${name} taken off the class.`);
      router.refresh();
    });
  }

  async function check(): Promise<boolean> {
    const empty = taught.filter((c) => c.subjects.length === 0);
    if (taught.length && empty.length) {
      toast.warning(`${empty.map((c) => c.name).join(", ")} ${empty.length === 1 ? "has" : "have"} no subject yet. You can add them later under Subjects.`);
    }
    return true;
  }

  if (!taught.length) {
    return (
      <>
        <p className="p-6 text-muted-foreground">
          Add a class with a section first (step 2); subjects are taught to a class.
        </p>
        <Footer prev={prev} next={next} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <div className="rounded-lg border bg-muted/30 p-4">
          <SectionTitle icon={Wand2}>Quick Add Common Subjects</SectionTitle>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Click to add common subjects to all classes at once:</p>
          <div className="flex flex-wrap gap-2">
            {COMMON_SUBJECTS.map((s) => (
              <Button key={s} type="button" variant="outline" size="sm" className="border-brand-accent text-brand-accent" disabled={pending} onClick={() => add(s, taught.map((c) => c.id))}>
                <Plus className="size-3.5" aria-hidden="true" /> {s}
              </Button>
            ))}
          </div>
        </div>
        {taught.map((c) => {
          const has = new Set(c.subjects.map((s) => s.name.toLowerCase()));
          const quick = [...COMMON_SUBJECTS, ...MORE_SUBJECTS].filter((s) => !has.has(s.toLowerCase()));
          return (
            <div key={c.id} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 font-semibold">
                  <GraduationCap className="size-4 text-primary" aria-hidden="true" /> {c.name}
                </h4>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">
                  {c.subjects.length} {c.subjects.length === 1 ? "subject" : "subjects"}
                </span>
              </div>
              {c.subjects.length > 0 && (
                <ul className="mb-3 flex flex-wrap gap-2" aria-label={`Subjects of ${c.name}`}>
                  {c.subjects.map((s) => (
                    <li key={s.id} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground">
                      {s.name}
                      <button type="button" aria-label={`Take ${s.name} off ${c.name}`} className="rounded-full p-0.5 hover:bg-background/20" disabled={pending} onClick={() => remove(s.id, s.name, c.id)}>
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mb-2 text-sm text-muted-foreground">Quick add for this class:</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {quick.map((s) => (
                  <button key={s} type="button" disabled={pending} onClick={() => add(s, [c.id])} className="rounded border px-2 py-1 text-xs hover:border-brand-accent hover:text-brand-accent">
                    {s}
                  </button>
                ))}
              </div>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (typed[c.id] ?? "").trim();
                  if (!name) return;
                  add(name, [c.id]);
                  setTyped((t) => ({ ...t, [c.id]: "" }));
                }}
              >
                <Input
                  aria-label={`Another subject for ${c.name}`}
                  value={typed[c.id] ?? ""}
                  onChange={(e) => setTyped((t) => ({ ...t, [c.id]: e.target.value }))}
                  placeholder="Enter subject name"
                  maxLength={100}
                  className="min-w-0 flex-1"
                />
                <Button type="submit" variant="outline" className="border-brand-accent text-brand-accent" disabled={pending}>
                  <Plus className="size-4" aria-hidden="true" /> Add Another Subject
                </Button>
              </form>
            </div>
          );
        })}
      </div>
      <Footer prev={prev} next={next} onNext={check} pending={pending} />
    </>
  );
}

// ------------------------------------------------------------ student types

const QUICK_TYPES: [string, LucideIcon][] = [
  ["Regular", User],
  ["Carry Forward", ArrowRight],
  ["Carry-over", ArrowRight],
  ["Private Candidate", User],
  ["Management Quota", Briefcase],
  ["Direct Admission", UserPlus],
  ["Admission Through Counselling", Users],
  ["Day Scholar", Sun],
  ["Hostel", Bed],
  ["Transport", Bus],
  ["Scholarship", GraduationCap],
  ["Sports Quota", Trophy],
  ["NRI", Globe],
];

export function StudentTypesStep({ types, prev, next }: { types: WizardState["studentTypes"] } & Nav) {
  const have = new Set(types.map((t) => t.name.toLowerCase()));
  const [rows, setRows] = useState<string[]>([""]);
  const filled = rows.map((r) => r.trim()).filter(Boolean);

  async function save(): Promise<boolean> {
    if (!filled.length) {
      if (types.some((t) => t.isActive)) return true;
      toast.error("Add at least one kind of student.");
      return false;
    }
    const fresh = filled.filter((n) => !have.has(n.toLowerCase()));
    if (!fresh.length) return true;
    const r = await wizardAddStudentTypes(fresh);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    reportList(r.data.added, r.data.failed, ["kind of student", "kinds of student"]);
    setRows([""]);
    return r.data.failed.length === 0;
  }

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <div>
          <SectionTitle icon={Users}>Define Student Types</SectionTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Create different student categories to help organize your student body. Student types help you
            categorize students based on enrollment status, residence, fee structure, or other criteria. Each
            student is given one on the admission form, and a type can have its own fees.
          </p>
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex flex-col gap-5">
            <div className="rounded-lg border bg-muted/30 p-4">
              <h4 className="flex items-center gap-2 text-lg">
                <Wand2 className="size-4 text-primary" aria-hidden="true" /> Quick Add Common Student Types
              </h4>
              <p className="mb-3 mt-1 text-sm text-muted-foreground">Click to quickly add common student type categories:</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_TYPES.filter(([n]) => !have.has(n.toLowerCase()) && !filled.includes(n)).map(([name, Icon]) => (
                  <Button
                    key={name}
                    type="button"
                    variant="outline"
                    className="border-brand-accent text-brand-accent"
                    onClick={() => setRows((r) => [...r.filter((x) => x.trim()), name])}
                  >
                    <Icon className="size-4" aria-hidden="true" /> {name}
                  </Button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between border-b pb-3">
                <h4 className="flex items-center gap-2 text-lg">
                  <Plus className="size-4 text-primary" aria-hidden="true" /> Add Student Types
                </h4>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">{filled.length} types</span>
              </div>
              <ul className="flex flex-col gap-2">
                {rows.map((value, i) => (
                  <li key={i} className="flex gap-2 rounded-md border p-2">
                    <Input
                      aria-label={`Student type ${i + 1}`}
                      value={value}
                      maxLength={60}
                      placeholder="Enter student type name"
                      onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    <Button type="button" variant="outline" size="icon" aria-label="Remove this row" className="border-destructive text-destructive" onClick={() => setRows((r) => (r.length === 1 ? [""] : r.filter((_, j) => j !== i)))}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="border-brand-accent text-brand-accent" onClick={() => setRows((r) => [...r, ""])}>
                  <Plus className="size-4" aria-hidden="true" /> Add Another Type
                </Button>
                <Button type="button" variant="outline" onClick={() => setRows([""])}>
                  <Trash2 className="size-4" aria-hidden="true" /> Clear All
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-primary p-4 text-primary-foreground">
              <h4 className="mb-3 flex items-center gap-2 text-lg">
                <Check className="size-5" aria-hidden="true" /> Existing Student Types
              </h4>
              {types.length === 0 ? (
                <p className="text-sm opacity-90">None yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {types.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 rounded bg-background px-3 py-2 text-foreground">
                      <span>{t.name}</span>
                      {t.isActive ? (
                        <span className="rounded bg-primary p-0.5 text-primary-foreground" aria-label="In use">
                          <Check className="size-3.5" aria-hidden="true" />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Switched off</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border p-4 text-sm">
              <h4 className="mb-2 flex items-center gap-2 text-base">
                <Info className="size-4 text-primary" aria-hidden="true" /> What are Student Types?
              </h4>
              <p className="text-muted-foreground">
                Student types help you categorize students based on their enrollment status, residence, fee
                structure, or any other criteria that&apos;s important for your school management.
              </p>
              <p className="mb-1 mt-3">Examples:</p>
              <ul className="flex flex-col gap-1 text-muted-foreground">
                <li>Regular vs Carry Forward</li>
                <li>Direct Admission vs Counselling</li>
                <li>Day Scholar vs Hostel</li>
                <li>Regular vs Private Candidate</li>
              </ul>
              <Link href="/students/types" className="mt-3 inline-block text-primary underline">
                Manage all student types
              </Link>
            </div>
          </div>
        </div>
      </div>
      <Footer prev={prev} next={next} onNext={save} nextLabel={filled.length ? "Save and continue" : "Next"} />
    </>
  );
}

// ---------------------------------------------------------------- fee types

const QUICK_FEES: [string, number, string][] = [
  ["Tuition Fee", 5000, "annual"],
  ["Admission Fee", 1000, "one_time"],
  ["Development Fee", 2000, "annual"],
  ["Library Fee", 500, "annual"],
  ["Laboratory Fee", 800, "annual"],
  ["Sports Fee", 300, "annual"],
  ["Transport Fee", 1200, "monthly"],
  ["Hostel Fee", 3000, "monthly"],
  ["Examination Fee", 200, "annual"],
  ["Computer Fee", 600, "annual"],
];
const FREQUENCIES = [
  ["one_time", "One time"],
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["annual", "Yearly"],
] as const;


export function FeeTypesStep({
  heads,
  classCount,
  sessionName,
  prev,
  next,
}: { heads: WizardState["feeHeads"]; classCount: number; sessionName: string | null } & Nav) {
  const { formatCurrency } = useI18n();
  const rupees = (n: number) => formatCurrency(n);
  const have = new Set(heads.map((h) => h.name.toLowerCase()));
  const [rows, setRows] = useState<{ name: string; amount: string; frequency: string }[]>([]);
  const valid = rows.filter((r) => r.name.trim().length >= 2);
  const total = valid.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  async function save(): Promise<boolean> {
    if (!valid.length) {
      if (heads.length) return true;
      toast.error("Add at least one fee type.");
      return false;
    }
    const bad = valid.find((r) => r.amount !== "" && (!Number.isFinite(Number(r.amount)) || Number(r.amount) < 0));
    if (bad) {
      toast.error(`The amount for ${bad.name} is not a number.`);
      return false;
    }
    const r = await wizardAddFeeTypes(valid.map((v) => ({ name: v.name.trim(), amount: Number(v.amount) || 0, frequency: v.frequency })));
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    reportList(r.data.added, r.data.failed, ["fee type", "fee types"]);
    setRows([]);
    return r.data.failed.length === 0;
  }

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <p>Fee Types</p>
        <div className="rounded-lg bg-muted/40 p-5">
          <p className="mb-3 text-lg">Quick Add</p>
          <div className="flex flex-wrap gap-3">
            {QUICK_FEES.filter(([n]) => !have.has(n.toLowerCase()) && !rows.some((r) => r.name === n)).map(([name, amount, frequency]) => (
              <button
                key={name}
                type="button"
                onClick={() => setRows((r) => [...r, { name, amount: String(amount), frequency }])}
                className="flex min-w-36 flex-col items-center gap-1 rounded-md border border-brand-accent bg-card px-5 py-3 text-brand-accent hover:bg-muted"
              >
                <span>{name}</span>
                <span className="text-xs text-muted-foreground">{rupees(amount)}</span>
              </button>
            ))}
          </div>
        </div>

        {heads.length > 0 && (
          <div className="rounded-lg border p-4">
            <p className="mb-2 font-medium">Fee types already set up</p>
            <ul className="flex flex-wrap gap-2">
              {heads.map((h) => (
                <li key={h.id} className="rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground">
                  {h.name}
                  <span className="opacity-80"> · {h.classesPriced ? `${h.classesPriced} of ${classCount} classes priced` : "no amount yet"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg border p-5">
          <div className="mb-3 flex items-center justify-between border-b pb-3">
            <p className="text-lg">Fee Types</p>
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">{valid.length} types</span>
          </div>
          {rows.length > 0 && (
            <ul className="mb-3 flex flex-col gap-2">
              {rows.map((r, i) => (
                <li key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input aria-label="Fee type name" value={r.name} maxLength={100} placeholder="Fee type name" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <Input aria-label="Amount in rupees" inputMode="decimal" value={r.amount} placeholder="Amount (₹)" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                  <select
                    aria-label="How often"
                    value={r.frequency}
                    onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, frequency: e.target.value } : y)))}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {FREQUENCIES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" size="icon" aria-label={`Remove ${r.name || "this row"}`} className="border-destructive text-destructive" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" size="lg" className="border-brand-accent text-brand-accent" onClick={() => setRows((x) => [...x, { name: "", amount: "", frequency: "annual" }])}>
              Add Another Fee Type
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={() => setRows([])}>
              Clear All
            </Button>
          </div>
        </div>

        <div className="rounded-lg bg-muted/40 p-5">
          <div className="flex items-center justify-between">
            <p className="text-lg">Fee Structure Preview</p>
            <p className="font-semibold text-primary">{rupees(total)}</p>
          </div>
          {valid.length === 0 ? (
            <p className="mt-3 flex flex-col items-center gap-1 text-sm text-muted-foreground">
              <Info className="size-4" aria-hidden="true" />
              Fee types will appear here as you add them.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {valid.map((v, i) => (
                <li key={i} className="flex justify-between border-b py-1">
                  <span>
                    {v.name} <span className="text-muted-foreground">({FREQUENCIES.find(([f]) => f === v.frequency)?.[1]})</span>
                  </span>
                  <span className="tabular-nums">{rupees(Number(v.amount) || 0)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Each amount is set for every class in {sessionName ?? "this year"}. Change a class&apos;s amount, or give
            a kind of student its own, under Fee Types.
          </p>
        </div>
      </div>
      <Footer prev={prev} next={next} onNext={save} nextLabel={valid.length ? "Save and continue" : "Next"} />
    </>
  );
}

// ---------------------------------------------------- registration settings

const REQUIRED_GROUPS: [string, [string, string][]][] = [
  ["Personal Information", [["date_of_birth", "Date of Birth"], ["gender", "Gender"], ["blood_group", "Blood Group"]]],
  ["Contact Information", [["phone", "Phone Number"], ["email", "Email"], ["address_line1", "Full Address"], ["city", "City"], ["state", "State"], ["postal_code", "PIN code"]]],
  ["Additional Details", [["roll_number", "Roll Number"], ["medium", "Medium"], ["house", "House"]]],
];

export function RegistrationStep({
  registration,
  heads,
  prev,
  next,
}: { registration: WizardState["registration"]; heads: WizardState["feeHeads"] } & Nav) {
  const [online, setOnline] = useState(registration.online);
  const [email, setEmail] = useState(registration.contactEmail);
  const [phone, setPhone] = useState(registration.phone);
  const [required, setRequired] = useState<Record<string, boolean>>(registration.required);
  const [bill, setBill] = useState<Record<string, boolean>>(Object.fromEntries(heads.map((h) => [h.id, h.billOnAdmission])));

  async function save(): Promise<boolean> {
    const changedBill = Object.fromEntries(Object.entries(bill).filter(([id, on]) => heads.find((h) => h.id === id)?.billOnAdmission !== on));
    const r = await wizardSaveRegistration({ online, contactEmail: email, phone, required, billOnAdmission: changedBill });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("Registration settings saved.");
    return true;
  }

  const toggleRow = (id: string, checked: boolean, onChange: (v: boolean) => void, title: string, body: string) => (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{body}</span>
      </Label>
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <UserPlus className="size-12 text-brand-accent" aria-hidden="true" />
          <h3 className="text-2xl text-brand-accent">Student Registration Settings</h3>
          <p className="text-sm text-muted-foreground">Configure how students can register at your school and what information they need to provide.</p>
        </div>

        <fieldset className="rounded-lg border p-5">
          <legend className="sr-only">Basic Registration Settings</legend>
          <SectionTitle icon={Settings}>Basic Registration Settings</SectionTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-note">Note at the top of the online form</Label>
              <Input id="reg-note" value={online.note} maxLength={300} placeholder="Admissions open for 2026-27" onChange={(e) => setOnline({ ...online, note: e.target.value })} />
              <p className="text-xs text-muted-foreground">This appears at the top of the registration form.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-email">Admin Email for Notifications</Label>
              <Input id="reg-email" type="email" value={email} placeholder="admin@school.com" onChange={(e) => setEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">The college&apos;s main contact address.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-phone">Admin Phone</Label>
              <Input id="reg-phone" value={phone} placeholder="+91 98765 43210" onChange={(e) => setPhone(e.target.value)} />
              <p className="text-xs text-muted-foreground">The college&apos;s phone number, printed on its documents.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reg-hour">Applications accepted per hour</Label>
              <Input id="reg-hour" inputMode="numeric" value={String(online.perHour)} onChange={(e) => setOnline({ ...online, perHour: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              <p className="text-xs text-muted-foreground">Protects the enquiry board from a flood.</p>
            </div>
          </div>
          {registration.slug && (
            <p className="mt-4 text-sm">
              Online form address:{" "}
              <Link href={`/apply/${registration.slug}`} className="font-mono text-primary underline" target="_blank">
                /apply/{registration.slug}
              </Link>
            </p>
          )}
        </fieldset>

        <fieldset className="rounded-lg border p-5">
          <legend className="sr-only">Registration Options</legend>
          <SectionTitle icon={ListChecks}>Registration Options</SectionTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {toggleRow("reg-online", online.enabled, (v) => setOnline({ ...online, enabled: v }), "Accept Applications Online", "Families can apply from the public form; each application arrives in Inquiries.")}
            {heads.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add a fee type (step 5) to bill it automatically when a student is admitted.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="font-semibold">Auto-create Invoices at admission</p>
                {heads.map((h) =>
                  toggleRow(`reg-bill-${h.id}`, bill[h.id] === true, (v) => setBill((b) => ({ ...b, [h.id]: v })), h.name, "Billed automatically when a student is admitted."),
                )}
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="rounded-lg border bg-muted/30 p-5">
          <legend className="sr-only">Required Student Information</legend>
          <SectionTitle icon={ListChecks}>Required Student Information</SectionTitle>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Select which fields must be filled in to admit a student. Class, section and student type are always required.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            {REQUIRED_GROUPS.map(([group, fields]) => (
              <div key={group}>
                <p className="mb-2 text-brand-accent">{group}</p>
                <ul className="flex flex-col gap-2">
                  {fields.map(([key, label]) => (
                    <li key={key} className="flex items-center gap-2">
                      <Checkbox id={`req-${key}`} checked={required[key] === true} onCheckedChange={(v) => setRequired((r) => ({ ...r, [key]: v === true }))} />
                      <Label htmlFor={`req-${key}`} className="font-normal">
                        {label}
                      </Label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="rounded-lg border p-5">
          <legend className="sr-only">Registration Success Message</legend>
          <SectionTitle icon={Check}>Registration Success Message</SectionTitle>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="reg-success">Success Message</Label>
            <Textarea id="reg-success" rows={3} maxLength={500} value={online.successMessage} placeholder="Your registration has been submitted. We will call you within two working days." onChange={(e) => setOnline({ ...online, successMessage: e.target.value })} />
            <p className="text-xs text-muted-foreground">This message will be displayed to families after they apply online.</p>
          </div>
        </fieldset>

        <div className="rounded-lg border border-primary p-5">
          <p className="mb-3 flex items-center gap-2 rounded bg-primary px-3 py-2 text-primary-foreground">
            <Lightbulb className="size-4" aria-hidden="true" /> Recommended Settings
          </p>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 text-primary">✓ Enable These Fields:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>Date of Birth</li>
                <li>Phone Number</li>
                <li>Gender</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 font-medium">⚠ Consider Carefully:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>Too many required fields slow the admission desk</li>
                <li>Auto-billing a fee nobody has priced bills nothing</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <Footer prev={prev} next={next} onNext={save} nextLabel="Save and continue" />
    </>
  );
}
