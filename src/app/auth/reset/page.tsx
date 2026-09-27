import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ResetForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Reached from the emailed link, after `/auth/callback` has turned it into a
 * session. `/auth` is public in the middleware, so this page checks for the
 * session itself: without one the link has expired or been used, and the
 * honest screen says so and offers a new one.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const [{ expired }, t, supabase] = await Promise.all([searchParams, getT(), createClient()]);
  const { data } = await supabase.auth.getUser();
  const usable = !expired && Boolean(data.user);

  return (
    <main className="flex min-h-svh items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">{t("auth.reset.title")}</h1>
        {usable ? (
          <div className="mt-8">
            <ResetForm />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("auth.reset.expired")}</p>
            <Link href="/auth/forgot" className="text-sm underline underline-offset-4">
              {t("auth.forgot.submit")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
