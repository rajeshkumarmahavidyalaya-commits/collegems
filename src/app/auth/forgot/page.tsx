import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { ForgotForm } from "../auth-forms";

export const metadata: Metadata = { title: "Reset your password" };

/** Public: somebody who has forgotten their password is, by definition, signed out. */
export default async function ForgotPage() {
  const t = await getT();
  return (
    <main className="flex min-h-svh items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">{t("auth.forgot.title")}</h1>
        <p className="mt-1 mb-8 text-sm text-muted-foreground">{t("auth.forgot.body")}</p>
        <ForgotForm />
      </div>
    </main>
  );
}
