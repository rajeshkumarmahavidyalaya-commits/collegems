import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginBrandingCompact } from "../login/login-form";
import { StartForm } from "./start-form";
import { getUserContext } from "@/lib/auth/context";
import { logout } from "../login/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Start your school" };

// A short, honest list rather than the full IANA database. Every one of these
// is a place this product is actually sold into; a 400-entry dropdown is a
// worse answer to "where are you?" than six.
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Dubai",
  "UTC",
];

export default async function StartPage() {
  const ctx = await getUserContext();

  // Somebody who already belongs to a school has no business here, and the
  // function would refuse them anyway — but bouncing them is kinder than
  // letting them fill in a form that ends in a refusal.
  if (ctx?.tenantId) {
    redirect("/");
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md">
        <LoginBrandingCompact />
        <h1 className="text-2xl font-semibold text-foreground">Start your school</h1>
        <p className="mt-1 mb-8 text-sm text-muted-foreground">
          This creates the school, its first academic year, and the six roles. You will be its
          administrator.
        </p>

        <StartForm timezones={TIMEZONES} />

        {/*
          The escape hatch, and it matters. Somebody invited to an existing
          school who signs up before their invitation is sent lands here with no
          tenant and no way forward — rule 3's "correct failure mode" is correct
          about the data and says nothing to the person. Signing out and back in
          after the invitation exists is the fix, so the door is on this screen.
        */}
        <form action={logout} className="mt-8 border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">
            Waiting to join a school somebody else runs? Ask them to send the invitation to your
            email address, then sign in again.
          </p>
          <Button type="submit" variant="ghost" size="sm" className="mt-2 px-0">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
