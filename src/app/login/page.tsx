import type { Metadata } from "next";
import { LoginBranding, LoginForm } from "./login-form";
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
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-foreground">{t("login.title")}</h1>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">{t("login.subtitle")}</p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
