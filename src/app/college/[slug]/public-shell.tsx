import Link from "next/link";
import { ArrowLeft, School } from "lucide-react";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";
import { getT } from "@/lib/i18n/server";
import type { PublicCollege } from "@/lib/validations/public-pages";

/**
 * The frame of every public page: the college's name, the language switcher,
 * and a way back to the list of what the college has opened. A Server
 * Component; the words come from `getT()` on the server.
 */
export async function PublicShell({
  college,
  title,
  subtitle,
  back = true,
  children,
}: {
  college: PublicCollege | null;
  title?: string;
  subtitle?: string;
  back?: boolean;
  children: React.ReactNode;
}) {
  const t = await getT();
  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-4 print:hidden">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
            <School className="size-5 shrink-0 text-primary" aria-hidden="true" />
            {college ? <bdi className="truncate">{college.college}</bdi> : null}
          </span>
          <LanguageSwitcher showLabel />
        </div>
        {college && back ? (
          <Link
            href={`/college/${college.slug}`}
            className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-2 hover:underline print:hidden"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t("public.back")}
          </Link>
        ) : null}
        {title ? (
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
          </header>
        ) : null}
        {children}
      </div>
    </main>
  );
}

/**
 * One page for an unknown college, a closed page and an address mistyped:
 * every public function answers those with one null, so the page cannot be
 * used to ask which is true.
 */
export async function PublicClosed({ college }: { college: PublicCollege | null }) {
  const t = await getT();
  return (
    <PublicShell college={college}>
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card px-5 py-6">
        <h1 className="text-xl font-semibold text-foreground">{t("public.closed.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("public.closed.body")}</p>
      </section>
    </PublicShell>
  );
}

export const PUBLIC_METADATA = {
  // Found through the college's own website or a link it sends, never through
  // a search engine, as the application form (0268).
  robots: { index: false, follow: false },
} as const;
