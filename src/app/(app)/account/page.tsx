import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Your account" };

/** Every signed-in person's own page: today, changing their password (0289). */
export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Things only you can change about your login.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Change your password</CardTitle>
          <CardDescription>
            Forgotten it instead? Sign out and use <span className="font-medium">Forgotten your password?</span>{" "}
            on the sign-in page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
