import Link from "next/link";
import { getT } from "@/lib/i18n/server";

/**
 * A URL that matches no route at all — a typo, or a link from somewhere else.
 *
 * Distinct from `(app)/not-found.tsx`, which is for a route that exists and a
 * *row* that does not. This one is outside the group, so there is no app shell
 * and no auth check: the person may not be signed in, and finding out is what
 * following the link does. The root layout still wraps it, so the locale, the
 * fonts and the theme are all present — only the sidebar is missing, and it
 * would have nothing to be beside.
 *
 * The wording is shared with the in-app version deliberately. Two sentences for
 * "we could not open that" is two sentences to keep in step for a difference
 * the reader cannot see.
 */
export default async function RootNotFound() {
  const t = await getT();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-medium">{t("boundary.notFound.title")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("boundary.notFound.body")}</p>
      </div>
      <Link
        href="/"
        className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("boundary.notFound.back")}
      </Link>
    </main>
  );
}
