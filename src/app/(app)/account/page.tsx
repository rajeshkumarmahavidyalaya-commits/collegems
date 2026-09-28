import { Bus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserContext } from "@/lib/auth/context";
import { formatStopTime } from "@/lib/validations/transport-display";
import { currentStaffSeat } from "../transport/actions";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Your account" };

/**
 * Every signed-in person's own page: changing their password (0289), and,
 * for a member of staff with a seat on a school bus, where it picks them up
 * (0293). The seat is read through `transport_for_staff`, whose rows the
 * "staff view own transport_assignments" policy gives them whatever their
 * role -- a librarian with no transport permission still sees their own bus.
 */
export default async function AccountPage() {
  const ctx = await getUserContext();
  const seat = ctx?.staffId ? await currentStaffSeat(ctx.staffId) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Things only you can change about your login.</p>
      </div>
      {seat && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bus className="size-4 text-muted-foreground" aria-hidden="true" />
              Your bus
            </CardTitle>
            <CardDescription>
              Route {seat.routeCode} · {seat.routeName}
              {seat.effectiveEndsOn ? `, until ${seat.effectiveEndsOn}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Stop</dt>
                <dd className="mt-0.5 text-sm">{seat.stopName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Pickup</dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums">{formatStopTime(seat.pickupTime)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Drop</dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums">{formatStopTime(seat.dropTime)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Vehicle</dt>
                <dd className="mt-0.5 text-sm">{seat.vehicle ?? "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
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
