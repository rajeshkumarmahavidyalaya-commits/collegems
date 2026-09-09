import type { Metadata } from "next";
import { LoginBranding, LoginBrandingCompact } from "../login/login-form";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="hidden lg:block">
        <LoginBranding />
      </div>
      <div className="relative flex items-center justify-center p-6 sm:p-10">
        {/* Same reasoning as the login page: somebody who cannot read the
            default language has no profile yet, so the cookie is the only place
            their choice can live (rule 15). */}
        <div className="absolute top-4 end-4 sm:top-6 sm:end-6">
          <LanguageSwitcher showLabel />
        </div>

        <div className="w-full max-w-sm">
          <LoginBrandingCompact />
          <h1 className="text-2xl font-semibold text-foreground">Create an account</h1>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">
            One account, whether you are starting a school or joining one you have been invited to.
          </p>
          <SignupForm />
        </div>
      </div>
    </main>
  );
}
