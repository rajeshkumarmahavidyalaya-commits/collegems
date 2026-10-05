"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bed,
  BookText,
  Briefcase,
  Calculator,
  Bus,
  Check,
  CheckCheck,
  CheckCircle2,
  FlaskConical,
  Globe,
  GraduationCap,
  Info,
  Languages,
  Laptop,
  Lightbulb,
  ListChecks,
  Loader2,
  Palette,
  PersonStanding,
  Plus,
  Settings,
  Sun,
  ToggleRight,
  Trash2,
  TriangleAlert,
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
import { FORM_PANELS, type FormPanel, type RequiredFieldKey } from "@/lib/validations/admission-required";
import {
  wizardAddClasses,
  wizardAddFeeTypes,
  wizardAddStudentTypes,
  wizardRemoveSubject,
  wizardSaveSubjects,
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
      title={opts.disabled ? "Already in your school" : undefined}
      className={`flex min-h-14 items-center gap-3 rounded-md border px-4 py-3 ${opts.disabled ? "" : "cursor-pointer hover:bg-muted/30"}`}
    >
      <Checkbox
        checked={opts.checked}
        disabled={opts.disabled}
        onCheckedChange={(v) => toggle(name, v === true)}
        aria-label={opts.disabled ? `${name}, already in your school` : name}
        className="disabled:opacity-100"
      />
      <span className="min-w-0">{name}</span>
    </label>
  );

  return (
    <>
      <div className="flex flex-col gap-5 p-6">
        <div>
          <SectionTitle icon={Laptop}>Select Classes for Your School</SectionTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose which classes your school offers. You can modify this later from the settings.
          </p>
        </div>
        {/* One grid, as the reference draws it: the school's own classes ticked,
            the rest offered. A ticked class is not untickable here -- a class
            with registers and fees is removed under Manage Classes, which
            says what it holds. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => box(c.name, { checked: true, disabled: true }))}
          {offered.map((n) => box(n, { checked: chosen.has(n) }))}
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
            <Label htmlFor="wiz-class">A class not listed</Label>
            <Input id="wiz-class" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={60} placeholder="e.g. BCA I Year" />
          </div>
          <Button type="submit" variant="outline">
            <Plus className="size-4" aria-hidden="true" />
            Add to list
          </Button>
        </form>
        <div className="rounded-md bg-muted/40 p-4">
          <p className="mb-2">Quick Selection:</p>
          <div className="inline-flex overflow-hidden rounded-md border bg-card">
            <button type="button" className="flex items-center gap-1.5 border-e px-4 py-2 text-sm text-brand-accent hover:bg-muted" onClick={() => setChosen(new Set(offered))}>
              <CheckCheck className="size-4" aria-hidden="true" /> Select All
            </button>
            <button type="button" className="flex items-center gap-1.5 px-4 py-2 text-sm hover:bg-muted" onClick={() => setChosen(new Set())}>
              <X className="size-4" aria-hidden="true" /> Clear All
            </button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
            {chosen.size
              ? `${chosen.size} new ${chosen.size === 1 ? "class" : "classes"} will be added with section A when you press Next.`
              : `${classes.length} ${classes.length === 1 ? "class" : "classes"} in your school.`}
          </p>
        </div>
      </div>
      <Footer prev={prev} next={next} onNext={save} />
    </>
  );
}

// ----------------------------------------------------------------- subjects

/** The reference's six, added to every class at once. */
const COMMON_SUBJECTS: [string, LucideIcon][] = [
  ["Mathematics", Calculator],
  ["English", Languages],
  ["Science", FlaskConical],
  ["Social Studies", Globe],
  ["Physical Education", PersonStanding],
  ["Art", Palette],
];
/** The reference's five, under each class. */
const CLASS_QUICK = ["Math", "English", "Science", "History", "Geography"];

type SubjectRow = { name: string; code: string; kind: "theory" | "practical"; codeTouched: boolean };
const emptyRow = (): SubjectRow => ({ name: "", code: "", kind: "theory", codeTouched: false });

/** A code from the name, the way the server would choose one: "Social Studies" → SOCSTU. */
function codeFor(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((w) => w.slice(0, 3)).join("") : (words[0] ?? "")).slice(0, 8);
}

export function SubjectsStep({ classes, prev, next }: { classes: WizardState["classes"] } & Nav) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const taught = classes.filter((c) => c.sections > 0);
  const [rows, setRows] = useState<Record<string, SubjectRow[]>>(() =>
    Object.fromEntries(taught.map((c) => [c.id, [emptyRow()]])),
  );
  const filled = Object.entries(rows).flatMap(([classLevelId, list]) =>
    list.filter((r) => r.name.trim()).map((r) => ({ classLevelId, ...r })),
  );

  function update(classId: string, i: number, patch: Partial<SubjectRow>) {
    setRows((all) => ({
      ...all,
      [classId]: (all[classId] ?? []).map((r, j) => {
        if (j !== i) return r;
        const nextRow = { ...r, ...patch };
        if (patch.name !== undefined && !nextRow.codeTouched) nextRow.code = codeFor(patch.name);
        return nextRow;
      }),
    }));
  }

  /** A quick-add button fills the first empty row, or adds one; never a duplicate. */
  function quickAdd(classIds: string[], name: string) {
    setRows((all) => {
      const out = { ...all };
      for (const id of classIds) {
        const cls = taught.find((c) => c.id === id);
        const list = out[id] ?? [];
        const has = (n: string) => n.trim().toLowerCase() === name.toLowerCase();
        if (list.some((r) => has(r.name)) || cls?.subjects.some((x) => has(x.name))) continue;
        const row = { name, code: codeFor(name), kind: "theory" as const, codeTouched: false };
        const empty = list.findIndex((r) => !r.name.trim());
        out[id] = empty >= 0 ? list.map((r, j) => (j === empty ? row : r)) : [...list, row];
      }
      return out;
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

  async function save(): Promise<boolean> {
    if (!filled.length) {
      const empty = taught.filter((c) => c.subjects.length === 0);
      if (empty.length) {
        toast.warning(`${empty.map((c) => c.name).join(", ")} ${empty.length === 1 ? "has" : "have"} no subject yet. You can add them later under Subjects.`);
      }
      return true;
    }
    const noCode = filled.find((r) => !r.code.trim());
    if (noCode) {
      toast.error(`Give ${noCode.name} a code.`);
      return false;
    }
    const r = await wizardSaveSubjects(filled.map(({ classLevelId, name, code, kind }) => ({ classLevelId, name, code, kind })));
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    reportList(r.data.added, r.data.failed, ["subject", "subjects"]);
    // Keep only the rows that failed, so the office fixes those and nothing else.
    const failedNames = new Set(r.data.failed.map((f) => f.split(":")[0].trim().toLowerCase()));
    setRows((all) =>
      Object.fromEntries(
        Object.entries(all).map(([id, list]) => {
          const kept = list.filter((x) => x.name.trim() && failedNames.has(x.name.trim().toLowerCase()));
          return [id, kept.length ? kept : [emptyRow()]];
        }),
      ),
    );
    return r.data.failed.length === 0;
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
        <div>
          <SectionTitle icon={BookText}>Add Subjects for Your Classes</SectionTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Add subjects for each class. You can use quick-add buttons for common subjects or add custom ones. All
            subjects can be modified later from the subjects management section.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4">
          <h4 className="flex items-center gap-2 text-lg">
            <Wand2 className="size-4 text-primary" aria-hidden="true" /> Quick Add Common Subjects
          </h4>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Click to add common subjects to all classes at once:</p>
          <div className="flex flex-wrap gap-3">
            {COMMON_SUBJECTS.map(([name, Icon]) => (
              <Button
                key={name}
                type="button"
                variant="outline"
                className="border-brand-accent text-brand-accent"
                onClick={() => quickAdd(taught.map((c) => c.id), name)}
              >
                <Icon className="size-4" aria-hidden="true" /> {name}
              </Button>
            ))}
          </div>
        </div>

        {taught.map((c) => {
          const list = rows[c.id] ?? [emptyRow()];
          return (
            <section key={c.id} className="rounded-lg border p-4" aria-labelledby={`wiz-class-${c.id}`}>
              <div className="mb-3 flex items-center justify-between gap-2 border-b pb-3">
                <h4 id={`wiz-class-${c.id}`} className="flex items-center gap-2 text-lg">
                  <Laptop className="size-5 text-brand-accent" aria-hidden="true" /> {c.name}
                </h4>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold">
                  {c.subjects.length} {c.subjects.length === 1 ? "subject" : "subjects"}
                </span>
              </div>
              {c.subjects.length > 0 && (
                <ul className="mb-3 flex flex-wrap gap-2" aria-label={`Subjects of ${c.name}`}>
                  {c.subjects.map((x) => (
                    <li key={x.id} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-sm text-primary-foreground">
                      {x.name}
                      <button
                        type="button"
                        aria-label={`Take ${x.name} off ${c.name}`}
                        className="rounded-full p-0.5 hover:bg-background/20"
                        disabled={pending}
                        onClick={() => remove(x.id, x.name, c.id)}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="rounded-md bg-muted/40 p-3">
                <p className="mb-2 text-sm text-muted-foreground">Quick add for this class:</p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {CLASS_QUICK.map((name) => (
                    <Button key={name} type="button" variant="outline" className="border-primary text-primary" onClick={() => quickAdd([c.id], name)}>
                      {name}
                    </Button>
                  ))}
                </div>
                <ul className="flex flex-col gap-2">
                  {list.map((r, i) => (
                    <li key={i} className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <Input
                        aria-label={`Subject name, ${c.name}, row ${i + 1}`}
                        value={r.name}
                        maxLength={100}
                        placeholder="Subject name"
                        onChange={(e) => update(c.id, i, { name: e.target.value })}
                      />
                      <Input
                        aria-label={`Code, ${c.name}, row ${i + 1}`}
                        value={r.code}
                        maxLength={20}
                        placeholder="Code *"
                        required={Boolean(r.name.trim())}
                        onChange={(e) => update(c.id, i, { code: e.target.value.toUpperCase(), codeTouched: true })}
                      />
                      <select
                        aria-label={`Type, ${c.name}, row ${i + 1}`}
                        value={r.kind}
                        onChange={(e) => update(c.id, i, { kind: e.target.value === "practical" ? "practical" : "theory" })}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                      >
                        <option value="theory">Theory</option>
                        <option value="practical">Practical</option>
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Remove row ${i + 1} of ${c.name}`}
                        className="border-destructive text-destructive"
                        onClick={() => setRows((all) => ({ ...all, [c.id]: list.length === 1 ? [emptyRow()] : list.filter((_, j) => j !== i) }))}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="border-brand-accent text-brand-accent" onClick={() => setRows((all) => ({ ...all, [c.id]: [...list, emptyRow()] }))}>
                    <Plus className="size-4" aria-hidden="true" /> Add Another Subject
                  </Button>
                  <Button type="button" variant="outline" className="border-warning text-warning" onClick={() => setRows((all) => ({ ...all, [c.id]: [emptyRow()] }))}>
                    <Trash2 className="size-4" aria-hidden="true" /> Clear All
                  </Button>
                </div>
              </div>
            </section>
          );
        })}
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {filled.length
            ? `${filled.length} ${filled.length === 1 ? "subject" : "subjects"} will be saved when you press Next.`
            : "Nothing new to save."}
        </p>
      </div>
      <Footer prev={prev} next={next} onNext={save} pending={pending} />
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

const PERSONAL: [RequiredFieldKey, string][] = [
  ["last_name", "Mandatory Last Name"],
  ["date_of_birth", "Date of Birth"],
  ["religion", "Religion"],
  ["caste", "Caste/Sub-caste"],
  ["blood_group", "Blood Group"],
  ["id_number", "ID Number/Proof"],
  ["student_photo", "Student Photo"],
  ["medical", "Medical Complaint"],
];
const CONTACT: [RequiredFieldKey, string][] = [
  ["phone", "Phone Number"],
  ["city", "City"],
  ["state", "State"],
  ["country", "Country"],
  ["address_line1", "Full Address"],
];
/** Ours, beyond the reference's list: fields the admission form also has. */
const MORE_REQUIRED: [RequiredFieldKey, string][] = [
  ["gender", "Gender"],
  ["email", "Email"],
  ["postal_code", "PIN code"],
  ["roll_number", "Roll Number"],
  ["medium", "Medium"],
  ["house", "House"],
];

export function RegistrationStep({
  registration,
  heads,
  prev,
  next,
}: { registration: WizardState["registration"]; heads: WizardState["feeHeads"] } & Nav) {
  const [online, setOnline] = useState(registration.online);
  const [required, setRequired] = useState(registration.required);
  const [panels, setPanels] = useState(registration.panels);
  const [numbers, setNumbers] = useState(registration.numbering);
  const [bill, setBill] = useState<Record<string, boolean>>(Object.fromEntries(heads.map((h) => [h.id, h.billOnAdmission])));
  const [autoInvoice, setAutoInvoice] = useState(heads.some((h) => h.billOnAdmission));

  function switchInvoices(on: boolean) {
    setAutoInvoice(on);
    if (!on) setBill(Object.fromEntries(heads.map((h) => [h.id, false])));
    else if (!heads.some((h) => bill[h.id])) {
      // The fee most colleges mean: the one named for admission, if there is one.
      const admission = heads.filter((h) => /admission/i.test(h.name));
      if (admission.length) setBill((b) => ({ ...b, ...Object.fromEntries(admission.map((h) => [h.id, true])) }));
    }
  }

  async function save(): Promise<boolean> {
    if (autoInvoice && heads.length && !heads.some((h) => bill[h.id])) {
      toast.error("Tick the fees to bill when a student is admitted, or switch Auto-create Invoices off.");
      return false;
    }
    const changedBill = Object.fromEntries(Object.entries(bill).filter(([id, on]) => heads.find((h) => h.id === id)?.billOnAdmission !== on));
    const r = await wizardSaveRegistration({
      settings: { online, required, panels, numbering: numbers },
      billOnAdmission: changedBill,
    });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("Registration settings saved.");
    return true;
  }

  const option = (
    id: string,
    checked: boolean,
    onChange: ((v: boolean) => void) | null,
    title: string,
    body: string,
    note?: string,
  ) => (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange ?? undefined} disabled={!onChange} className="mt-0.5" aria-describedby={`${id}-body`} />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="font-semibold">
          {title}
        </Label>
        <span id={`${id}-body`} className="text-sm text-muted-foreground">
          {body}
          {note && <span className="mt-0.5 block text-xs">{note}</span>}
        </span>
      </div>
    </div>
  );

  const tick = (key: RequiredFieldKey, label: string) => (
    <li key={key} className="flex items-center gap-2">
      <Checkbox id={`req-${key}`} checked={required[key] === true} onCheckedChange={(v) => setRequired((r) => ({ ...r, [key]: v === true }))} />
      <Label htmlFor={`req-${key}`} className="font-normal">
        {label}
      </Label>
    </li>
  );

  const field = (id: string, label: string, help: string, input: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input}
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <UserPlus className="size-12 text-brand-accent" aria-hidden="true" />
          <h3 className="text-2xl text-brand-accent sm:text-3xl">Student Registration Settings</h3>
          <p className="text-sm text-muted-foreground">
            Configure how students can register at your school and what information they need to provide.
          </p>
        </div>

        <section className="rounded-lg border p-5" aria-labelledby="reg-basic">
          <h3 id="reg-basic" className="flex items-center gap-2 text-xl text-brand-accent">
            <Settings className="size-5" aria-hidden="true" /> Basic Registration Settings
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {field(
              "reg-title",
              "Registration Form Title",
              "This title will appear on the registration form.",
              <Input id="reg-title" value={online.formTitle} maxLength={120} placeholder="e.g., Student Registration Form" onChange={(e) => setOnline({ ...online, formTitle: e.target.value })} />,
            )}
            {field(
              "reg-email",
              "Admin Email for Notifications",
              "Email to receive registration notifications.",
              <Input id="reg-email" type="email" value={online.notifyEmail} placeholder="admin@school.com" onChange={(e) => setOnline({ ...online, notifyEmail: e.target.value })} />,
            )}
            {field(
              "reg-phone",
              "Admin Phone for SMS Notifications",
              "Phone number to receive SMS notifications.",
              <Input id="reg-phone" type="tel" value={online.notifyPhone} placeholder="+91 98765 43210" onChange={(e) => setOnline({ ...online, notifyPhone: e.target.value })} />,
            )}
            {field(
              "reg-redirect",
              "Redirect URL After Registration",
              "Where to redirect students after successful registration.",
              <Input id="reg-redirect" type="url" value={online.redirectUrl} placeholder="https://school.com/thank-you" onChange={(e) => setOnline({ ...online, redirectUrl: e.target.value })} />,
            )}
          </div>
        </section>

        <section className="rounded-lg border p-5" aria-labelledby="reg-options">
          <h3 id="reg-options" className="flex items-center gap-2 text-xl text-primary">
            <ToggleRight className="size-5" aria-hidden="true" /> Registration Options
          </h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              {option(
                "reg-autologin",
                false,
                null,
                "Auto-login After Registration",
                "Automatically log in students after they register.",
                "Not offered: an online application is an enquiry, not a login. Invite the family from the admission form.",
              )}
              {option(
                "reg-approval",
                true,
                null,
                "Require Admin Approval",
                "Students will be inactive until approved by admin.",
                "Always on: an application waits in Inquiries until the office admits the child.",
              )}
              {option("reg-invoice", autoInvoice, switchInvoices, "Auto-create Invoices", "Automatically create invoices based on fee types.")}
              {autoInvoice &&
                (heads.length === 0 ? (
                  <p className="ms-12 text-sm text-muted-foreground">Add a fee type (step 5) to bill it when a student is admitted.</p>
                ) : (
                  <fieldset className="ms-12 flex flex-col gap-2">
                    <legend className="mb-1 text-sm">Billed when a student is admitted:</legend>
                    {heads.map((h) => (
                      <label key={h.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={bill[h.id] === true} onCheckedChange={(v) => setBill((b) => ({ ...b, [h.id]: v === true }))} />
                        {h.name}
                        {h.classesPriced === 0 && <span className="text-xs text-muted-foreground">(no amount yet)</span>}
                      </label>
                    ))}
                  </fieldset>
                ))}
            </div>
            <div className="flex flex-col gap-4">
              {option(
                "reg-admno",
                numbers.autoAdmissionNumber,
                (v) => setNumbers({ ...numbers, autoAdmissionNumber: v }),
                "Auto-generate Admission Numbers",
                "Automatically generate admission numbers for new students.",
              )}
              {numbers.autoAdmissionNumber && (
                <div className="ms-12 flex flex-col gap-1.5">
                  <Label htmlFor="reg-prefix" className="text-sm">
                    Prefix
                  </Label>
                  <Input id="reg-prefix" value={numbers.admissionPrefix} maxLength={12} placeholder="e.g. ADM-" className="max-w-48" onChange={(e) => setNumbers({ ...numbers, admissionPrefix: e.target.value })} />
                  <p className="text-xs text-muted-foreground">The next number after the largest one with this prefix is filled in on the admission form.</p>
                </div>
              )}
              {option(
                "reg-roll",
                numbers.autoRollNumber,
                (v) => setNumbers({ ...numbers, autoRollNumber: v }),
                "Auto-generate Roll Numbers",
                "Automatically generate roll numbers for new students.",
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border bg-muted/30 p-5" aria-labelledby="reg-required">
          <h3 id="reg-required" className="flex items-center gap-2 text-xl text-primary">
            <ListChecks className="size-5" aria-hidden="true" /> Required Student Information
          </h3>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            Select which fields students must fill during registration. Class, section and student type are always
            required.
          </p>
          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <p className="mb-2 text-brand-accent">Personal Information</p>
              <ul className="flex flex-col gap-2">{PERSONAL.map(([k, l]) => tick(k, l))}</ul>
            </div>
            <div>
              <p className="mb-2 text-brand-accent">Contact Information</p>
              <ul className="flex flex-col gap-2">{CONTACT.map(([k, l]) => tick(k, l))}</ul>
            </div>
            <div>
              <p className="mb-2 text-brand-accent">Additional Panels</p>
              <ul className="flex flex-col gap-2">
                {(Object.keys(FORM_PANELS) as FormPanel[]).map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <Checkbox id={`panel-${k}`} checked={panels[k]} onCheckedChange={(v) => setPanels((p) => ({ ...p, [k]: v === true }))} />
                    <Label htmlFor={`panel-${k}`} className="font-normal">
                      {FORM_PANELS[k].label}
                    </Label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-lg border p-5" aria-labelledby="reg-success-title">
          <h3 id="reg-success-title" className="flex items-center gap-2 text-xl text-primary">
            <CheckCircle2 className="size-5" aria-hidden="true" /> Registration Success Message
          </h3>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="reg-success">Success Message</Label>
            <Textarea
              id="reg-success"
              rows={4}
              maxLength={500}
              value={online.successMessage}
              placeholder="Thank you for registering! We will contact you soon..."
              onChange={(e) => setOnline({ ...online, successMessage: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">This message will be displayed to students after successful registration.</p>
          </div>
        </section>

        <section className="rounded-lg border p-5" aria-labelledby="reg-online-form">
          <h3 id="reg-online-form" className="flex items-center gap-2 text-xl text-brand-accent">
            <Globe className="size-5" aria-hidden="true" /> Online Registration Form
          </h3>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">
            The public form families apply on. Each application arrives in Inquiries, and is announced to the admin email
            and phone above.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {option("reg-online", online.enabled, (v) => setOnline({ ...online, enabled: v }), "Accept Applications Online", "Show the form at the address below.")}
            {field(
              "reg-hour",
              "Applications accepted per hour",
              "Protects the enquiry board from a flood.",
              <Input id="reg-hour" inputMode="numeric" value={String(online.perHour)} onChange={(e) => setOnline({ ...online, perHour: Number(e.target.value.replace(/\D/g, "")) || 0 })} />,
            )}
            <div className="sm:col-span-2">
              {field(
                "reg-note",
                "Note at the top of the form",
                "For example: Admissions open for 2026-27 until 30 June.",
                <Input id="reg-note" value={online.note} maxLength={300} onChange={(e) => setOnline({ ...online, note: e.target.value })} />,
              )}
            </div>
          </div>
          {registration.slug && (
            <p className="mt-4 text-sm">
              Form address:{" "}
              <Link href={`/apply/${registration.slug}`} className="font-mono text-primary underline" target="_blank">
                /apply/{registration.slug}
              </Link>
            </p>
          )}
          <p className="mb-2 mt-5 text-brand-accent">Also required at admission</p>
          <ul className="grid gap-2 sm:grid-cols-3">{MORE_REQUIRED.map(([k, l]) => tick(k, l))}</ul>
        </section>

        <div className="rounded-lg border border-primary p-5">
          <p className="mb-3 flex items-center gap-2 rounded bg-primary px-3 py-2 text-primary-foreground">
            <Lightbulb className="size-4" aria-hidden="true" /> Recommended Settings
          </p>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 flex items-center gap-1 text-primary">
                <Check className="size-4" aria-hidden="true" /> Enable These Fields:
              </p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>Date of Birth</li>
                <li>Phone Number</li>
                <li>Parent Details Panel</li>
                <li>Auto-generate Admission Numbers</li>
              </ul>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1 text-warning">
                <TriangleAlert className="size-4" aria-hidden="true" /> Consider Carefully:
              </p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>Require Admin Approval (delays student access)</li>
                <li>Too many required fields (complex forms)</li>
                <li>Student Photo (may reduce registrations)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <Footer prev={prev} next={next} onNext={save} />
    </>
  );
}
