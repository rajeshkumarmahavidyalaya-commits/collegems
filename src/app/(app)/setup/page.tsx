import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bus,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  IdCard,
  IndianRupee,
  Info,
  ListChecks,
  Megaphone,
  MonitorPlay,
  Route,
  ScrollText,
  Library,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { parseSetupProgress } from "@/lib/validations/setup";
import { SetupWizard } from "@/components/dashboard/setup-wizard";
import { wizardState } from "./actions";
import { ClassesStep, FeeTypesStep, RegistrationStep, StudentTypesStep, SubjectsStep } from "./wizard-steps";
import { WIZARD_STEPS, type WizardStepKey } from "./steps";

export const metadata = { title: "School Setup Wizard" };

/**
 * The reference's School Setup Wizard: seven steps down the left, the step in
 * front, Previous and Next underneath, and a progress bar measured from the
 * school's own records rather than from which pages somebody clicked through.
 * Each step writes through the module's own write path (see ./actions); a step
 * is "Completed" when the records say so.
 *
 * The administrator's: every write here is an administrator's write under the
 * policies, so anybody else is told so instead of being shown forms that
 * would refuse them.
 */
export default async function SetupWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ step: asked }, ctx] = await Promise.all([searchParams, getUserContext()]);
  const keys = WIZARD_STEPS.map((s) => s.key);
  const step: WizardStepKey = keys.includes(asked as WizardStepKey) ? (asked as WizardStepKey) : "welcome";
  const index = keys.indexOf(step);

  if (ctx?.roleCode !== "admin") {
    return (
      <div className="flex flex-col gap-4">
        <Banner />
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          The setup wizard creates classes, subjects, kinds of student and fees, which only an
          administrator can do. Ask your administrator to run it.
        </p>
      </div>
    );
  }

  const state = await wizardState();
  const taught = state.classes.filter((c) => c.sections > 0);
  const done: Record<WizardStepKey, boolean> = {
    welcome: true,
    classes: taught.length > 0,
    subjects: taught.length > 0 && taught.every((c) => c.subjects.length > 0),
    student_types: state.studentTypes.some((t) => t.isActive),
    fee_types: state.feeHeads.length > 0,
    registration_settings: state.registrationSaved,
    complete: false,
  };
  done.complete = done.classes && done.subjects && done.student_types && done.fee_types;
  const completed = keys.filter((k) => done[k]).length;
  const percent = Math.round((completed / keys.length) * 100);
  const prev = index > 0 ? `/setup?step=${keys[index - 1]}` : null;
  const next = index < keys.length - 1 ? `/setup?step=${keys[index + 1]}` : null;
  const meta = WIZARD_STEPS[index];

  return (
    <div className="flex flex-col gap-5">
      <Banner />

      <div>
        <div
          className="h-3 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Setup complete"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{
              width: `${percent}%`,
              backgroundImage:
                "repeating-linear-gradient(45deg, transparent 0 8px, color-mix(in oklab, var(--primary-foreground) 25%, transparent) 8px 16px)",
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-sm text-muted-foreground">
          <span>
            Step {index + 1} of {keys.length}
          </span>
          <span>{percent}% Complete</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <nav aria-label="Setup steps" className="h-fit rounded-lg border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 border-b pb-3 font-semibold text-primary">
            <ListChecks className="size-5" aria-hidden="true" />
            Setup Steps
          </h2>
          <ol className="flex flex-col gap-2.5">
            {WIZARD_STEPS.map((s, i) => {
              const active = s.key === step;
              const isDone = done[s.key];
              const Icon = s.icon;
              return (
                <li key={s.key}>
                  <Link
                    href={`/setup?step=${s.key}`}
                    aria-current={active ? "step" : undefined}
                    className={[
                      "flex items-center gap-3 rounded-lg border p-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-brand-accent bg-brand-accent text-brand-accent-foreground shadow-md"
                        : isDone
                          ? "border-primary bg-primary text-primary-foreground hover:opacity-95"
                          : "bg-card hover:bg-muted/50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                        active ? "bg-background text-foreground" : isDone ? "" : "bg-muted-foreground text-background",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      {isDone && !active ? <CheckCircle2 className="size-5" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-semibold">
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {s.title}
                        {s.required && (
                          <span aria-label="required" className={active || isDone ? "" : "text-destructive"}>
                            *
                          </span>
                        )}
                      </span>
                      <span className="block text-xs opacity-90">{s.subtitle}</span>
                      {isDone && !active && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded bg-background px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                          <Check className="size-3" aria-hidden="true" /> Completed
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-labelledby="wizard-step-title">
          <header className="flex items-center gap-4 border-b px-6 py-5">
            <meta.icon className="size-9 shrink-0 text-brand-accent" aria-hidden="true" />
            <div>
              <h2 id="wizard-step-title" className="text-2xl font-medium">
                {meta.title}
              </h2>
              <p className="text-sm text-muted-foreground">{meta.subtitle}</p>
            </div>
          </header>

          {step === "welcome" && (
            <>
              <Welcome />
              <Footer prev={prev} next={next} />
            </>
          )}
          {step === "classes" && <ClassesStep classes={state.classes} prev={prev} next={next} />}
          {step === "subjects" && <SubjectsStep classes={state.classes} prev={prev} next={next} />}
          {step === "student_types" && <StudentTypesStep types={state.studentTypes} prev={prev} next={next} />}
          {step === "fee_types" && (
            <FeeTypesStep heads={state.feeHeads} classCount={state.classes.length} sessionName={state.sessionName} prev={prev} next={next} />
          )}
          {step === "registration_settings" && (
            <RegistrationStep registration={state.registration} heads={state.feeHeads} prev={prev} next={next} />
          )}
          {step === "complete" && (
            <>
              <Complete done={done} />
              <Footer prev={prev} next={null} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The reference's tall banner. A <header>, not a <div>: the shell restyles a
 * page's first <div> holding an <h1> into the module title bar, which drew
 * this one as a thin bar with a second icon. The size is inline for the same
 * reason -- `.reference-page h1` is unlayered and outranks a utility.
 */
function Banner() {
  return (
    <header className="rounded-lg bg-primary px-6 py-7 text-center text-primary-foreground shadow-md">
      <h1
        className="flex items-center justify-center gap-3 font-bold"
        style={{ fontSize: "clamp(1.5rem, 1.1rem + 1.6vw, 2rem)", lineHeight: 1.2 }}
      >
        <Wand2 className="size-8 shrink-0" aria-hidden="true" />
        School Setup Wizard
      </h1>
      <p className="mt-1 text-sm opacity-90">Configure your school in just a few simple steps</p>
    </header>
  );
}

function Footer({ prev, next }: { prev: string | null; next: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-6 py-4">
      {prev ? (
        <Button asChild variant="outline" size="lg">
          <Link href={prev}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Previous
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {next && (
        <Button asChild size="lg">
          <Link href={next}>
            Next
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}

function Welcome() {
  const items: [LucideIcon, string, string][] = [
    [MonitorPlay, "Classes & Sections", "Configure your school classes and sections"],
    [BookOpen, "Subjects", "Add subjects for each class"],
    [Users, "Student Types", "Define different student categories"],
    [IndianRupee, "Fee Structure", "Set up fee types and amounts"],
    [UserPlus, "Registration Settings", "Customize student registration forms"],
  ];
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-8 text-center">
      <GraduationCap className="size-16 text-primary" aria-hidden="true" />
      <h3 className="text-2xl font-medium text-primary sm:text-3xl">Welcome to School Management Setup!</h3>
      <p className="text-lg text-muted-foreground">This wizard will help you configure your school in just a few simple steps.</p>
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-primary text-start">
        <div className="flex items-center gap-3 bg-primary px-5 py-3 text-lg text-primary-foreground">
          <ListChecks className="size-5" aria-hidden="true" />
          What We&apos;ll Set Up
        </div>
        <ul className="grid gap-5 p-5 sm:grid-cols-2">
          {items.map(([Icon, title, body]) => (
            <li key={title} className="flex gap-3">
              <Icon className="size-9 shrink-0 text-primary" aria-hidden="true" />
              <span>
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="flex w-full max-w-2xl items-center justify-center gap-2 rounded-lg bg-primary/10 px-4 py-3 text-primary">
        <Info className="size-4 shrink-0" aria-hidden="true" />
        This process will take approximately 5-10 minutes to complete.
      </p>
    </div>
  );
}

async function Complete({ done }: { done: Record<WizardStepKey, boolean> }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("setup_progress");
  const next: [LucideIcon, string, string, string, string][] = [
    [Users, "Add Students", "Start adding students to your school and assign them to classes.", "/students/new", "Add Students"],
    [UserPlus, "Add Teachers", "Add teachers and assign them to classes and subjects.", "/staff/new", "Add Teachers"],
    [CalendarClock, "Schedule Classes", "Create class schedules and timetables for your school.", "/timetable", "Create Schedule"],
    [Library, "Library", "Manage library books and cards.", "/library/books", "Go to Library"],
    [Bus, "Transport", "Manage school transport and routes.", "/transport", "Go to Transport"],
    [IndianRupee, "Accounting", "Manage fees, invoices, and expenses.", "/fees/setup", "Go to Accounting"],
    [IdCard, "ID Cards", "Generate student ID cards.", "/students/id-cards", "Go to ID Cards"],
    [Megaphone, "Notices", "Send important notices to students.", "/notices", "Go to Notices"],
    [ScrollText, "Certificates", "Issue certificates to students.", "/certificates", "Go to Certificates"],
  ];
  const summary: [boolean, string, string][] = [
    [true, "School Information", "Basic school details configured"],
    [done.classes, "Classes Assignment", "Classes assigned to your school"],
    [done.subjects, "Subjects Configuration", "Subjects added for each class"],
    [done.student_types, "Student Types", "Student categories defined"],
    [done.fee_types, "Fee Types", "Fee categories set up"],
    [done.registration_settings, "Registration Settings", "Student registration form configured"],
  ];
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="rounded-lg border border-brand-accent p-5">
          <h3 className="mb-4 flex items-center gap-2 text-xl text-brand-accent">
            <Route className="size-5" aria-hidden="true" />
            What&apos;s Next?
          </h3>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {next.map(([Icon, title, body, href, label]) => (
              <li key={title} className="flex flex-col items-center gap-2 text-center">
                <Icon className="size-8 text-brand-accent" aria-hidden="true" />
                <span className="text-lg text-brand-accent">{title}</span>
                <span className="text-sm text-muted-foreground">{body}</span>
                <Button asChild variant="outline" size="sm" className="mt-auto border-brand-accent">
                  <Link href={href}>{label}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="h-fit rounded-lg border p-5">
          <h3 className="mb-3 flex items-center gap-2 rounded-md bg-primary px-4 py-3 text-lg text-primary-foreground">
            <ClipboardList className="size-5" aria-hidden="true" />
            Setup Summary
          </h3>
          <p className="mb-2 text-primary">✓ Completed Steps</p>
          <ul className="flex flex-col gap-3">
            {summary.map(([ok, title, body]) => (
              <li key={title}>
                <span className="flex items-center gap-2 font-semibold">
                  {ok ? (
                    <Check className="size-4 text-primary" aria-label="Done" />
                  ) : (
                    <span className="text-destructive" aria-label="Not yet">✕</span>
                  )}
                  {title}
                </span>
                <span className="ms-6 block text-sm text-muted-foreground">{ok ? body : "Not done yet"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardCheck className="size-5 text-primary" aria-hidden="true" />
          Everything else a college sets up
        </h3>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <SetupWizard steps={parseSetupProgress(data)} />
        )}
      </div>
    </div>
  );
}
