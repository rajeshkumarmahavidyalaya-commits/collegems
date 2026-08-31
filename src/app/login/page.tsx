import type { Metadata } from "next";
import { LoginBranding, LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="hidden lg:block">
        <LoginBranding />
      </div>
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-foreground">Sign in</h1>
          <p className="mt-1 mb-8 text-sm text-muted-foreground">
            Use the account your school administrator gave you.
          </p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
