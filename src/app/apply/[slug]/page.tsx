import type { Metadata } from "next";
import { School } from "lucide-react";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages/en";
import { ADMISSION_GENDERS } from "@/lib/validations/admissions-display";
import { ApplyForm, type ApplyLabels } from "./apply-form";

export const metadata: Metadata = {
  title: "Apply",
  // A college's form is found through the college's own website or a link it
  // sends, never through a search engine: it is not a page about the college.
  robots: { index: false, follow: false },
};

type AdmissionForm = {
  college: string;
  session: string | null;
  note: string | null;
  classLevels: { id: string; name: string }[];
};

/**
 * `admission_form` returns jsonb or null. Read defensively: this is the one
 * page whose data comes from a function anybody can call, and a shape nobody
 * expected should render the closed page rather than a stack trace.
 */
function readForm(data: unknown): AdmissionForm | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.college !== "string") return null;
  const levels = Array.isArray(d.class_levels) ? d.class_levels : [];
  return {
    college: d.college,
    session: typeof d.session === "string" ? d.session : null,
    note: typeof d.note === "string" ? d.note : null,
    classLevels: levels.flatMap((l) =>
      l && typeof l === "object" && typeof (l as { id?: unknown }).id === "string"
        ? [{ id: (l as { id: string }).id, name: String((l as { name?: unknown }).name ?? "") }]
        : [],
    ),
  };
}

/**
 * The public application form — the one page in this product that needs no
 * account. `/apply` is in the middleware's `PUBLIC_PATHS`, and everything this
 * page and its action can do is decided by two `SECURITY DEFINER` functions
 * named, with their reasons, in `definer_guard_violations()` (migration 0268).
 *
 * **The form receives its words as props, resolved here.** Not for weight: the
 * language switcher calls `useI18n()`, so this route carries the catalogue
 * whatever the form does, and a public page is the one that most needs a
 * switcher. It is so the labels, the field errors and the refusals all come
 * from one `getT()` on the server, in the language the request resolved to,
 * rather than two translators that could disagree about which that was.
 */
export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, t, supabase] = await Promise.all([params, getT(), createClient()]);
  const { data } = await supabase.rpc("admission_form", { p_slug: slug });
  const form = readForm(data);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <School className="size-5 text-primary" aria-hidden="true" />
            {form ? <bdi>{form.college}</bdi> : null}
          </span>
          <LanguageSwitcher showLabel />
        </div>

        {form ? (
          <>
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold text-foreground">
                {t("apply.title", { college: form.college })}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("apply.subtitle", { session: form.session ?? "" })}
              </p>
              {form.note ? (
                // The college's own words, written in its settings. Rendered as
                // text, never as markup: it is a setting, not a template.
                <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm whitespace-pre-line text-foreground">
                  {form.note}
                </p>
              ) : null}
            </header>

            <ApplyForm
              slug={slug}
              college={form.college}
              classLevels={form.classLevels}
              labels={labelsFor(t, form.college)}
              genders={ADMISSION_GENDERS.map((g) => ({ value: g, label: t(`apply.gender.${g}` as MessageKey) }))}
            />
          </>
        ) : (
          // One page for an unknown college, a closed one and one with no
          // current year -- `admission_form` returns one null for all three, so
          // the page cannot be used to ask which is true.
          <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-5 py-6">
            <h1 className="text-xl font-semibold text-foreground">{t("apply.closed.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("apply.closed.body")}</p>
          </section>
        )}
      </div>
    </main>
  );
}

function labelsFor(t: Translator, college: string): ApplyLabels {
  return {
    sectionChild: t("apply.section.child"),
    sectionContact: t("apply.section.contact"),
    firstName: t("apply.firstName"),
    lastName: t("apply.lastName"),
    dateOfBirth: t("apply.dateOfBirth"),
    gender: t("apply.gender"),
    genderChoose: t("apply.gender.choose"),
    classLevel: t("apply.classLevel"),
    classLevelNone: t("apply.classLevel.none"),
    contactName: t("apply.contactName"),
    relationship: t("apply.relationship"),
    relationshipHint: t("apply.relationshipHint"),
    phone: t("apply.phone"),
    email: t("apply.email"),
    contactHint: t("apply.contactHint"),
    notes: t("apply.notes"),
    optional: t("apply.optional"),
    submit: t("apply.submit"),
    submitting: t("apply.submitting"),
    privacy: t("apply.privacy", { college }),
    doneTitle: t("apply.done.title"),
    doneBody: t("apply.done.body", { college }),
    doneDuplicate: t("apply.done.duplicate"),
    doneReference: t("apply.done.reference"),
    doneAnother: t("apply.done.another"),
  };
}
