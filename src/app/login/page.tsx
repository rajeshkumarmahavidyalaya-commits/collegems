import type { Metadata } from "next";
import { LoginBranding, LoginBrandingCompact, LoginForm } from "./login-form";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, t] = await Promise.all([searchParams, getT()]);

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="hidden lg:block">
        <LoginBranding />
      </div>
      <div className="relative flex items-center justify-center p-6 sm:p-10">
        {/*
          The one screen where this control has to exist. `user_profiles.locale`
          cannot hold a choice made by somebody who has not signed in, which is
          why the cookie step exists at all (rule 15) — and until now nothing
          wrote that cookie before the app shell, so the reader who could not
          read the default had no way to change it. Top of the reading order,
          before the form, so it is found rather than hunted for.
        */}
        <div className="absolute top-4 end-4 sm:top-6 sm:end-6">
          <LanguageSwitcher showLabel />
        </div>

        <div className="w-full max-w-sm">
          <LoginBrandingCompact />
          <h1 className="text-2xl font-semibold text-foreground">{t("login.title")}</h1>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">{t("login.subtitle")}</p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
